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

            // NO link should happen (conflict detected upfront)
            expect(fs.ensureSymlink).not.toHaveBeenCalled();

            // Warning should be logged about the conflict
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('CONFLICT'));
            // Should mention both patterns/roots
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('/test/cwd'));
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('/test/cwd/src'));
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

    describe('removeAllLinks', () => {
        it('should remove all tracked symlinks', async () => {
            const config = {
                include: ['**/*'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath1 = '/test/cwd/sub1';
            const dirPath2 = '/test/cwd/sub2';

            // Create some symlinks first
            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);
            await symLinker.checkAndLink(dirPath1, [config]);
            await symLinker.checkAndLink(dirPath2, [config]);

            // Now remove all links
            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
            (fs.lstat as unknown as jest.Mock).mockResolvedValue({
                isSymbolicLink: () => true
            });

            await symLinker.removeAllLinks();

            // Verify unlink was called for both symlinks
            expect(fs.unlink).toHaveBeenCalledWith(path.join(dirPath1, 'AGENTS.md'));
            expect(fs.unlink).toHaveBeenCalledWith(path.join(dirPath2, 'AGENTS.md'));
            expect(fs.unlink).toHaveBeenCalledTimes(2);
        });

        it('should handle removing already-removed symlinks gracefully (no ENOENT errors)', async () => {
            const config = {
                include: ['**/*'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath1 = '/test/cwd/sub1';
            const dirPath2 = '/test/cwd/sub2';

            // Create some symlinks first
            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);
            await symLinker.checkAndLink(dirPath1, [config]);
            await symLinker.checkAndLink(dirPath2, [config]);

            // Simulate the bug: pathExists says true, lstat says it's a symlink, but unlink fails with ENOENT
            // This happens when two cleanup processes race - first removes file, second tries to remove already-removed file
            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
            (fs.lstat as unknown as jest.Mock).mockResolvedValue({
                isSymbolicLink: () => true
            });

            // Mock unlink to throw ENOENT error (simulating file was removed between pathExists check and unlink call)
            const enoentError = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
            enoentError.code = 'ENOENT';
            (fs.unlink as unknown as jest.Mock).mockRejectedValue(enoentError);

            // This should NOT throw an error even though unlink fails with ENOENT
            await expect(symLinker.removeAllLinks()).resolves.not.toThrow();
        });


        it('should handle concurrent cleanup (duplicate calls) without errors', async () => {
            const config = {
                include: ['**/*'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath = '/test/cwd/sub1';

            // Create a symlink
            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);
            await symLinker.checkAndLink(dirPath, [config]);

            // First call: file exists and is removed
            let callCount = 0;
            (fs.pathExists as unknown as jest.Mock).mockImplementation(async () => {
                callCount++;
                // First call returns true, second returns false (already removed)
                return callCount === 1;
            });
            (fs.lstat as unknown as jest.Mock).mockResolvedValue({
                isSymbolicLink: () => true
            });

            // Call removeAllLinks twice in parallel (simulating duplicate signal handling)
            const [result1, result2] = await Promise.allSettled([
                symLinker.removeAllLinks(),
                symLinker.removeAllLinks()
            ]);

            // Both calls should succeed without errors
            expect(result1.status).toBe('fulfilled');
            expect(result2.status).toBe('fulfilled');
        });
    });

    describe('removeLinkSync (SIGINT-safe)', () => {
        it('should synchronously remove a symlink if it exists', () => {
            const config = {
                include: ['**/*'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath = '/test/cwd/sub';

            // First create a link via async (which tracks it)
            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);

            // Mock sync operations
            (fs.existsSync as unknown as jest.Mock).mockReturnValue(true);
            (fs.lstatSync as unknown as jest.Mock).mockReturnValue({
                isSymbolicLink: () => true
            });

            // Create link first (to populate linkedDirs)
            symLinker.checkAndLink(dirPath, [config]).then(() => {
                // Now test sync removal
                symLinker.removeLinkSync(dirPath);

                expect(fs.existsSync).toHaveBeenCalledWith(path.join(dirPath, 'AGENTS.md'));
                expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(dirPath, 'AGENTS.md'));
            });
        });

        it('should handle non-existent files gracefully', () => {
            const dirPath = '/test/cwd/nonexistent';

            (fs.existsSync as unknown as jest.Mock).mockReturnValue(false);

            // Should not throw
            expect(() => symLinker.removeLinkSync(dirPath)).not.toThrow();
            expect(fs.unlinkSync).not.toHaveBeenCalled();
        });

        it('should handle ENOENT errors gracefully (race condition)', () => {
            const config = {
                include: ['**/*'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath = '/test/cwd/sub';

            // File exists when checked
            (fs.existsSync as unknown as jest.Mock).mockReturnValue(true);
            (fs.lstatSync as unknown as jest.Mock).mockReturnValue({
                isSymbolicLink: () => true
            });

            // But unlinkSync fails with ENOENT (race condition - another process removed it)
            const enoentError = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
            enoentError.code = 'ENOENT';
            (fs.unlinkSync as unknown as jest.Mock).mockImplementation(() => {
                throw enoentError;
            });

            // Should not throw
            expect(() => symLinker.removeLinkSync(dirPath)).not.toThrow();
        });

        it('should not remove real files (only symlinks)', () => {
            const dirPath = '/test/cwd/sub';

            (fs.existsSync as unknown as jest.Mock).mockReturnValue(true);
            (fs.lstatSync as unknown as jest.Mock).mockReturnValue({
                isSymbolicLink: () => false // It's a real file
            });

            symLinker.removeLinkSync(dirPath);

            expect(fs.unlinkSync).not.toHaveBeenCalled();
        });
    });

    describe('removeAllLinksSync (SIGINT-safe)', () => {
        it('should synchronously remove all tracked symlinks', async () => {
            const config = {
                include: ['**/*'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath1 = '/test/cwd/sub1';
            const dirPath2 = '/test/cwd/sub2';

            // Create some symlinks first (async, but we wait for them)
            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);
            await symLinker.checkAndLink(dirPath1, [config]);
            await symLinker.checkAndLink(dirPath2, [config]);

            // Mock sync operations for removal
            (fs.existsSync as unknown as jest.Mock).mockReturnValue(true);
            (fs.lstatSync as unknown as jest.Mock).mockReturnValue({
                isSymbolicLink: () => true
            });

            // Call sync removal
            symLinker.removeAllLinksSync();

            // Verify unlinkSync was called for both
            expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(dirPath1, 'AGENTS.md'));
            expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(dirPath2, 'AGENTS.md'));
            expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
        });

        it('should clear linkedDirs after removal', async () => {
            const config = {
                include: ['**/*'],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            };
            const dirPath = '/test/cwd/sub';

            (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);
            await symLinker.checkAndLink(dirPath, [config]);

            expect(symLinker.hasLinks()).toBe(true);

            (fs.existsSync as unknown as jest.Mock).mockReturnValue(true);
            (fs.lstatSync as unknown as jest.Mock).mockReturnValue({
                isSymbolicLink: () => true
            });

            symLinker.removeAllLinksSync();

            expect(symLinker.hasLinks()).toBe(false);
        });
    });
});

