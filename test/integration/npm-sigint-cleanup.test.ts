import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Integration test for SIGINT cleanup when running via npm scripts.
 * 
 * THIS IS THE ACTUAL BUG SCENARIO: When running sym-agents via `npm run`,
 * npm wraps the process in a shell that may not properly forward SIGINT
 * to the child process. The fix is to use `exec` to replace the shell.
 */
describe('npm run SIGINT Cleanup', () => {
    let testDir: string;
    let agentsDir: string;
    let targetDir1: string;

    beforeEach(async () => {
        testDir = path.resolve(__dirname, '../../.test-tmp', `npm-sigint-test-${Date.now()}`);
        agentsDir = path.join(testDir, '.agents', 'components');
        targetDir1 = path.join(testDir, 'src', 'components', 'Foo');

        // Create test fixture
        await fs.ensureDir(agentsDir);
        await fs.ensureDir(targetDir1);

        // Create AGENTS.md source
        await fs.writeFile(path.join(agentsDir, 'AGENTS.md'), '# Test Agent');

        // Create config
        await fs.writeJson(path.join(agentsDir, 'agents.config.json'), {
            include: ['**/*'],
            exclude: ['node_modules', '.agents']
        });

        // Create a package.json with an npm script that runs sym-agents
        // This simulates the user's actual npm run scenario
        const distIndexPath = path.resolve(__dirname, '../../dist/index.js');
        await fs.writeJson(path.join(testDir, 'package.json'), {
            name: 'test-project',
            scripts: {
                // NO exec needed - the library should handle signals properly now
                'symAgents': `node ${distIndexPath} .`
            }
        });
    });

    afterEach(async () => {
        await fs.remove(testDir);
    });

    // Test that npm run script properly handles SIGINT with the library's internal fixes:
    // - process.stdin.resume() keeps event loop alive
    // - process.on('exit') as backup cleanup
    // - SIGHUP support
    it('should clean up symlinks when npm run script receives SIGINT', async () => {
        const distIndexPath = path.resolve(__dirname, '../../dist/index.js');

        if (!(await fs.pathExists(distIndexPath))) {
            console.warn('dist/index.js not found - skipping test');
            return;
        }

        // Spawn via npm run to simulate the actual user scenario
        // Use detached: true to create a new process group so we can send signals
        const child: ChildProcess = spawn('npm', ['run', 'symAgents'], {
            cwd: testDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: true // Creates new process group
        });

        let stdoutData = '';
        child.stdout?.on('data', (data: Buffer) => {
            stdoutData += data.toString();
        });

        let stderrData = '';
        child.stderr?.on('data', (data: Buffer) => {
            stderrData += data.toString();
        });

        // Wait for "Watching for changes"
        const watchingDetected = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 10000);
            const checkOutput = () => {
                if (stdoutData.includes('Watching for changes')) {
                    clearTimeout(timeout);
                    resolve(true);
                }
            };
            child.stdout?.on('data', checkOutput);
        });

        if (!watchingDetected) {
            try { process.kill(-child.pid!, 'SIGKILL'); } catch { }
            throw new Error('sym-agents did not start watching. stdout: ' + stdoutData + ' stderr: ' + stderrData);
        }

        // Wait for symlinks
        await new Promise(r => setTimeout(r, 2500));

        // Verify symlink created
        const symlinkPath = path.join(targetDir1, 'AGENTS.md');
        const symlinkExists = await fs.pathExists(symlinkPath);
        expect(symlinkExists).toBe(true);

        // Send SIGINT to the entire process group (simulates Ctrl+C in terminal)
        const exitResult = await new Promise<{ code: number | null }>((resolve, reject) => {
            const timeout = setTimeout(() => {
                try { process.kill(-child.pid!, 'SIGKILL'); } catch { }
                reject(new Error('Process did not exit after SIGINT. stdout: ' + stdoutData));
            }, 10000);

            child.on('exit', (code) => {
                clearTimeout(timeout);
                resolve({ code });
            });

            // Kill the process group - negative pid signals entire group
            try {
                process.kill(-child.pid!, 'SIGINT');
            } catch (e) {
                // If process group kill fails, try regular kill
                child.kill('SIGINT');
            }
        });

        // After SIGINT via npm run, symlinks should be cleaned up
        const symlinkExistsAfter = await fs.pathExists(symlinkPath);

        // THIS ASSERTION WILL FAIL if the fix doesn't work with npm run
        expect(symlinkExistsAfter).toBe(false);
        expect(stdoutData).toContain('Received SIGINT, cleaning up');
    }, 25000);
});
