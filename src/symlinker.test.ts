import { SymLinker } from './symlinker';
import * as fs from 'fs-extra';
import * as path from 'path';

jest.mock('fs-extra');

describe('SymLinker', () => {
    const cwd = '/test/cwd';
    let symLinker: SymLinker;

    beforeEach(() => {
        symLinker = new SymLinker(cwd);
        jest.clearAllMocks();
    });

    describe('shouldLink', () => {
        // Access private method via casting or just test via public checkAndLink
        // It's better to test public interface

        it('should link if file matches include pattern', async () => {
            const config = {
                include: ['**/*.ts'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath = '/test/cwd/src/foo.ts';

            // Mock implicit behavior of checkAndLink calling createSymlink
            // We need to spy on createSymlink or mock it if we can't access it easily.
            // Since it's private, we can mock fs.ensureSymlink to verify it was called.

            await symLinker.checkAndLink(dirPath, [config]);

            expect(fs.ensureSymlink).toHaveBeenCalled();
        });

        it('should NOT link if file matches exclude pattern', async () => {
            const config = {
                include: ['**/*.ts'],
                exclude: ['**/*.test.ts'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath = '/test/cwd/src/foo.test.ts';

            await symLinker.checkAndLink(dirPath, [config]);

            expect(fs.ensureSymlink).not.toHaveBeenCalled();
        });
    });

    describe('createSymlink', () => {
        it('should create a symlink if none exists', async () => {
            const config = {
                include: ['**/*'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath = '/test/cwd/sub';

            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);

            await symLinker.checkAndLink(dirPath, [config]);

            const expectedLinkPath = path.join(dirPath, 'AGENTS.md');
            expect(fs.ensureSymlink).toHaveBeenCalledWith(
                expect.stringContaining('AGENTS.md'), // relative target
                expectedLinkPath
            );
        });

        it('should not overwrite existing real files', async () => {
            const config = {
                include: ['**/*'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath = '/test/cwd/sub';

            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
            (fs.lstat as unknown as jest.Mock).mockResolvedValue({
                isSymbolicLink: () => false
            });

            await symLinker.checkAndLink(dirPath, [config]);

            expect(fs.ensureSymlink).not.toHaveBeenCalled();
            expect(fs.unlink).not.toHaveBeenCalled();
        });

        it('should update correct invalid symlinks', async () => {
            const config = {
                include: ['**/*'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath = '/test/cwd/sub';

            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
            (fs.lstat as unknown as jest.Mock).mockResolvedValue({
                isSymbolicLink: () => true
            });
            (fs.readlink as unknown as jest.Mock).mockResolvedValue('../wrong/path');

            await symLinker.checkAndLink(dirPath, [config]);

            const expectedLinkPath = path.join(dirPath, 'AGENTS.md');
            expect(fs.unlink).toHaveBeenCalledWith(expectedLinkPath);
            expect(fs.ensureSymlink).toHaveBeenCalled();
        });
    });
    describe('conflict detection', () => {
        let consoleWarnSpy: jest.SpyInstance;

        beforeEach(() => {
            consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        });

        afterEach(() => {
            consoleWarnSpy.mockRestore();
        });

        it('should warn and skip if directory matches multiple configs', async () => {
            // Use nested roots so both are valid parents of the target
            // Config 1 root: /test/cwd
            // Config 2 root: /test/cwd/src
            // Target: /test/cwd/src/component

            const config1 = {
                include: ['**/*'],
                rootDir: '/test/cwd',
                agentFile: '/test/cwd/AGENTS.md'
            };
            const config2 = {
                include: ['**/*'],
                rootDir: '/test/cwd/src',
                agentFile: '/test/cwd/src/AGENTS.md'
            };

            const dirPath = '/test/cwd/src/component';

            // Mock successful first link
            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);

            await symLinker.checkAndLink(dirPath, [config1, config2]);

            // First link should happen
            expect(fs.ensureSymlink).toHaveBeenCalledWith(
                expect.any(String),
                path.join(dirPath, 'AGENTS.md')
            );

            // Second link should NOT happen (conflict)
            // ensureSymlink should be called exactly once (for the first config)
            expect(fs.ensureSymlink).toHaveBeenCalledTimes(1);

            // Warning should be logged
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('CONFLICT'));
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('/test/cwd')); // One of them
            // The other might be /test/cwd/src or similar, checking for 'CONFLICT' is key
        });

        it('should allow same config to be processed again without warning', async () => {
            const config1 = {
                include: ['**/*'],
                rootDir: '/test/cwd',
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath = '/test/cwd/src/component';

            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);

            // Run twice with same config object
            await symLinker.checkAndLink(dirPath, [config1]);
            await symLinker.checkAndLink(dirPath, [config1]);

            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });
    });
});
