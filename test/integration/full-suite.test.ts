
import * as fs from 'fs-extra';
import * as path from 'path';
import { IntegrationTestContext } from './test-context';

describe('SymAgents Integration Suite', () => {
    let ctx: IntegrationTestContext;

    beforeEach(async () => {
        ctx = new IntegrationTestContext();
        await ctx.setup();
    });

    afterEach(async () => {
        await ctx.teardown();
    });

    describe('Feature: Basic Linking', () => {
        it('should correctly symlink AGENTS.md to matching directories', async () => {
            // Setup: Config and Directories
            await ctx.createFile('agents.config.json', JSON.stringify([
                {
                    include: ['components/**'],
                    rootDir: ctx.tmpDir,
                    agentFile: 'AGENTS.md'
                }
            ]));
            await ctx.createFile('AGENTS.md', '# Base Agent Rule');
            await ctx.createDir('components/Button');
            await ctx.createDir('components/Input');

            // Action: Run Once
            await ctx.runner.runOnce();

            // Verify
            const linkPathBtn = ctx.getFullPath('components/Button/AGENTS.md');
            expect(await fs.pathExists(linkPathBtn)).toBe(true);
            const stats = await fs.lstat(linkPathBtn);
            expect(stats.isSymbolicLink()).toBe(true);

            // Verify link target
            const target = await fs.readlink(linkPathBtn);
            // It should be a relative path: ../../AGENTS.md
            expect(target).toContain('AGENTS.md');

            const linkPathInput = ctx.getFullPath('components/Input/AGENTS.md');
            expect(await fs.pathExists(linkPathInput)).toBe(true);
        });
    });

    describe('Feature: Exclusions', () => {
        it('should NOT symlink excluded directories', async () => {
            await ctx.createFile('agents.config.json', JSON.stringify([
                {
                    include: ['**/*'],
                    exclude: ['node_modules/**'],
                    rootDir: ctx.tmpDir,
                    agentFile: 'AGENTS.md'
                }
            ]));
            await ctx.createFile('AGENTS.md');
            await ctx.createDir('src/components');
            await ctx.createDir('node_modules/lib');

            await ctx.runner.runOnce();

            expect(await fs.pathExists(ctx.getFullPath('src/components/AGENTS.md'))).toBe(true);
            expect(await fs.pathExists(ctx.getFullPath('node_modules/lib/AGENTS.md'))).toBe(false);
        });
    });

    describe('Feature: Conflict Detection (Multi-Pattern)', () => {
        it('should warn and skip linking if directory matches multiple configs', async () => {
            // Setup: Overlapping configs
            await ctx.createFile('AGENTS.md');
            await ctx.createFile('agents.config.json', JSON.stringify([
                {
                    include: ['**/*'],
                    rootDir: ctx.tmpDir,
                    agentFile: 'AGENTS.md'
                },
                {
                    include: ['src/**'],
                    rootDir: ctx.tmpDir,
                    agentFile: 'AGENTS.md'
                }
            ]));

            const targetDir = 'src/components';
            await ctx.createDir(targetDir);

            // Action
            await ctx.runner.runOnce();

            // Verify: NO link should be created
            const linkPath = ctx.getFullPath('src/components/AGENTS.md');
            expect(await fs.pathExists(linkPath)).toBe(false);
        });
    });

    describe('Feature: Watch Mode', () => {
        it('should dynamically link new directories and clean up on stop', async () => {
            await ctx.createFile('agents.config.json', JSON.stringify([
                {
                    include: ['components/**'],
                    rootDir: ctx.tmpDir,
                    agentFile: 'AGENTS.md'
                }
            ]));
            await ctx.createFile('AGENTS.md');

            // Start Watcher
            // Note: watch() is non-blocking in our implementation if we don't await the process, 
            // but runner.watch() method itself returns promise after setup.
            // However, callbacks are async. We need to wait for chokidar to react.
            await ctx.runner.watch();

            // Create new directory
            await ctx.createDir('components/Modal');

            // Wait for watcher to pick it up (robust polling)
            const linkPath = ctx.getFullPath('components/Modal/AGENTS.md');
            let found = false;
            for (let i = 0; i < 50; i++) {
                if (await fs.pathExists(linkPath)) {
                    found = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 100));
            }

            // Verify Link Created
            expect(found).toBe(true);
            expect(await fs.pathExists(linkPath)).toBe(true);

            // Stop/Cleanup
            await ctx.runner.stop();

            // Verify Cleanup
            expect(await fs.pathExists(ctx.getFullPath('components/Modal/AGENTS.md'))).toBe(false);
        }, 10000);
    });

    describe('Feature: Manual Removal (CLI)', () => {
        it('should remove existing symlinks even if they were not tracked (simulating CLI --remove)', async () => {
            // 1. Manually create a setup that looks like a previous run
            const config = [
                {
                    include: ['components/**'],
                    rootDir: ctx.tmpDir,
                    agentFile: 'AGENTS.md'
                }
            ];
            await ctx.createFile('agents.config.json', JSON.stringify(config));
            await ctx.createFile('AGENTS.md');
            await ctx.createDir('components/Button');

            const linkPath = ctx.getFullPath('components/Button/AGENTS.md');
            const targetPath = ctx.getFullPath('AGENTS.md');
            const relativeTarget = path.relative(path.dirname(linkPath), targetPath);
            await fs.ensureSymlink(relativeTarget, linkPath);

            expect(await fs.pathExists(linkPath)).toBe(true);

            // 2. Initialize a FRESH runner (no memory) - already done in setup()
            // 3. Run remove()
            await ctx.runner.remove();

            // Verify removal
            expect(await fs.pathExists(linkPath)).toBe(false);
        });
    });
    describe('Feature: Preservation of Existing Files', () => {
        it('should NOT overwrite or remove existing AGENTS.md files that are NOT symlinks', async () => {
            await ctx.createFile('agents.config.json', JSON.stringify([
                {
                    include: ['components/**'],
                    rootDir: ctx.tmpDir,
                    agentFile: 'AGENTS.md'
                }
            ]));
            await ctx.createFile('AGENTS.md', '# Global Agents');

            // Create a component with its OWN real AGENTS.md
            await ctx.createDir('components/Custom');
            const customContent = '# Custom Manual Agent';
            await ctx.createFile('components/Custom/AGENTS.md', customContent);

            // 1. Run Once (Linking phase)
            await ctx.runner.runOnce();

            const targetPath = ctx.getFullPath('components/Custom/AGENTS.md');

            // Verify content is UNCHANGED (not overwritten by symlink)
            expect(await fs.readFile(targetPath, 'utf8')).toBe(customContent);
            const stats = await fs.lstat(targetPath);
            expect(stats.isSymbolicLink()).toBe(false);

            // 2. Remove (Cleanup phase)
            await ctx.runner.remove();

            // Verify file still exists (not removed)
            expect(await fs.pathExists(targetPath)).toBe(true);
            expect(await fs.readFile(targetPath, 'utf8')).toBe(customContent);
        });
    });
    describe('Feature: Array Configuration Support', () => {
        it('should support multiple configs in a single file', async () => {
            await ctx.createFile('AGENTS_A.md', '# Agent A');
            await ctx.createFile('AGENTS_B.md', '# Agent B');

            // Array config
            await ctx.createFile('agents.config.json', JSON.stringify([
                {
                    include: ['libs/**'],
                    rootDir: ctx.tmpDir,
                    agentFile: 'AGENTS_A.md'
                },
                {
                    include: ['apps/**'],
                    rootDir: ctx.tmpDir,
                    agentFile: 'AGENTS_B.md'
                }
            ]));

            await ctx.createDir('libs/utils');
            await ctx.createDir('apps/frontend');

            await ctx.runner.runOnce();

            const linkA = ctx.getFullPath('libs/utils/AGENTS.md');
            const linkB = ctx.getFullPath('apps/frontend/AGENTS.md');

            expect(await fs.pathExists(linkA)).toBe(true);
            expect(await fs.readlink(linkA)).toContain('AGENTS_A.md');

            expect(await fs.pathExists(linkB)).toBe(true);
            expect(await fs.readlink(linkB)).toContain('AGENTS_B.md');
        });
    });
});
