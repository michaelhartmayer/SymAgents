import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Integration test for SIGINT cleanup behavior.
 * 
 * This test verifies that when sym-agents is terminated with SIGINT (Ctrl+C),
 * all symlinks are properly cleaned up before the process exits.
 * 
 * The root cause of the bug is that async cleanup operations may not complete
 * before the process exits when running under npm scripts.
 */
describe('SIGINT Cleanup', () => {
    // Use a unique test directory for each test run
    let testDir: string;
    let agentsDir: string;
    let targetDir1: string;
    let targetDir2: string;

    beforeEach(async () => {
        testDir = path.resolve(__dirname, '../../.test-tmp', `sigint-test-${Date.now()}`);
        agentsDir = path.join(testDir, '.agents', 'components');
        targetDir1 = path.join(testDir, 'src', 'components', 'Foo');
        targetDir2 = path.join(testDir, 'src', 'components', 'Bar');

        // Create test fixture
        await fs.ensureDir(agentsDir);
        await fs.ensureDir(targetDir1);
        await fs.ensureDir(targetDir2);

        // Create AGENTS.md source file in the .agents directory
        await fs.writeFile(path.join(agentsDir, 'AGENTS.md'), '# Test Agent');

        // Create config - use wildcards to catch deeply nested dirs
        // Pattern: **/* will match all directories recursively
        await fs.writeJson(path.join(agentsDir, 'agents.config.json'), {
            include: ['**/*'],
            exclude: ['node_modules', '.agents']
        });
    });

    afterEach(async () => {
        await fs.remove(testDir);
    });

    it('should clean up symlinks when receiving SIGINT', async () => {
        // Spawn sym-agents in watch mode
        const distIndexPath = path.join(__dirname, '..', '..', 'dist', 'index.js');

        // Verify the dist file exists before running
        if (!(await fs.pathExists(distIndexPath))) {
            console.warn('dist/index.js not found - skipping integration test. Run npm run build first.');
            return;
        }

        // Pass testDir as CLI argument so sym-agents uses correct directory
        const child: ChildProcess = spawn('node', [distIndexPath, testDir], {
            cwd: testDir,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdoutData = '';
        child.stdout?.on('data', (data: Buffer) => {
            stdoutData += data.toString();
        });

        let stderrData = '';
        child.stderr?.on('data', (data: Buffer) => {
            stderrData += data.toString();
        });

        // Wait for symlinks to be created (indicated by "Watching for changes" message)
        const watchingDetected = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 5000);

            const checkOutput = () => {
                if (stdoutData.includes('Watching for changes')) {
                    clearTimeout(timeout);
                    resolve(true);
                }
            };

            child.stdout?.on('data', checkOutput);
        });

        if (!watchingDetected) {
            child.kill('SIGKILL');
            throw new Error('sym-agents did not start watching within timeout');
        }

        // Give chokidar more time to detect directories and create symlinks
        await new Promise(r => setTimeout(r, 2000));

        // Verify symlinks were created
        const symlinkPath1 = path.join(targetDir1, 'AGENTS.md');
        const symlinkPath2 = path.join(targetDir2, 'AGENTS.md');

        const symlink1Exists = await fs.pathExists(symlinkPath1);
        const symlink2Exists = await fs.pathExists(symlinkPath2);

        expect(symlink1Exists).toBe(true);
        if (symlink1Exists) {
            const stats1 = await fs.lstat(symlinkPath1);
            expect(stats1.isSymbolicLink()).toBe(true);
        }

        expect(symlink2Exists).toBe(true);
        if (symlink2Exists) {
            const stats2 = await fs.lstat(symlinkPath2);
            expect(stats2.isSymbolicLink()).toBe(true);
        }

        // Send SIGINT and wait for exit
        const exitResult = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
            const timeout = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error('Process did not exit within timeout after SIGINT'));
            }, 5000);

            child.on('exit', (code, signal) => {
                clearTimeout(timeout);
                resolve({ code, signal });
            });

            child.kill('SIGINT');
        });

        // Exit code 0 = clean exit after handling SIGINT
        // Exit code 130 = killed by SIGINT without cleanup (128 + 2)
        // This is THE KEY ASSERTION for this bug fix
        expect(exitResult.code).toBe(0);

        // After SIGINT, symlinks should be cleaned up
        // This will FAIL before the fix because async cleanup doesn't complete
        const symlinkPath1AfterExit = await fs.pathExists(symlinkPath1);
        const symlinkPath2AfterExit = await fs.pathExists(symlinkPath2);

        expect(symlinkPath1AfterExit).toBe(false);
        expect(symlinkPath2AfterExit).toBe(false);

        // Verify the cleanup was logged
        expect(stdoutData).toContain('Received SIGINT, cleaning up');
        expect(stdoutData).toContain('Removed AGENTS.md');
    }, 15000); // 15 second timeout for this integration test

    it('should clean up symlinks when receiving SIGTERM', async () => {
        const distIndexPath = path.join(__dirname, '..', '..', 'dist', 'index.js');

        if (!(await fs.pathExists(distIndexPath))) {
            console.warn('dist/index.js not found - skipping integration test. Run npm run build first.');
            return;
        }

        // Pass testDir as CLI argument
        const child: ChildProcess = spawn('node', [distIndexPath, testDir], {
            cwd: testDir,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdoutData = '';
        child.stdout?.on('data', (data: Buffer) => {
            stdoutData += data.toString();
        });

        // Wait for watching
        const watchingDetected = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 5000);
            child.stdout?.on('data', () => {
                if (stdoutData.includes('Watching for changes')) {
                    clearTimeout(timeout);
                    resolve(true);
                }
            });
        });

        if (!watchingDetected) {
            child.kill('SIGKILL');
            throw new Error('sym-agents did not start watching within timeout');
        }

        await new Promise(r => setTimeout(r, 500));

        // Send SIGTERM instead of SIGINT
        const exitResult = await new Promise<{ code: number | null }>((resolve, reject) => {
            const timeout = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error('Process did not exit within timeout after SIGTERM'));
            }, 5000);

            child.on('exit', (code) => {
                clearTimeout(timeout);
                resolve({ code });
            });

            child.kill('SIGTERM');
        });

        expect(exitResult.code).toBe(0);

        // Symlinks should be cleaned up
        expect(await fs.pathExists(path.join(targetDir1, 'AGENTS.md'))).toBe(false);
        expect(await fs.pathExists(path.join(targetDir2, 'AGENTS.md'))).toBe(false);
    }, 15000);
});
