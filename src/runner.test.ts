import { AgentRunner } from './runner';
import { ConfigLoader } from './config';
import { SymLinker } from './symlinker';
import * as glob from 'glob';
import * as chokidar from 'chokidar';
import * as fs from 'fs-extra';

jest.mock('./config');
jest.mock('./symlinker');
jest.mock('glob');
jest.mock('chokidar');
jest.mock('fs-extra');

describe('AgentRunner', () => {
    const cwd = '/test/cwd';
    let agentRunner: AgentRunner;
    let mockConfigLoader: jest.Mocked<ConfigLoader>;
    let mockSymLinker: jest.Mocked<SymLinker>;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Setup mock instances
        mockConfigLoader = new ConfigLoader(cwd) as jest.Mocked<ConfigLoader>;
        mockSymLinker = new SymLinker(cwd) as jest.Mocked<SymLinker>;

        // Mock constructor behavior (not automatically handled by jest.mock for class instances)
        (ConfigLoader as jest.Mock).mockImplementation(() => mockConfigLoader);
        (SymLinker as jest.Mock).mockImplementation(() => mockSymLinker);

        agentRunner = new AgentRunner(cwd);
    });

    it('should initialize correctly', () => {
        expect(ConfigLoader).toHaveBeenCalledWith(cwd);
        expect(SymLinker).toHaveBeenCalledWith(cwd);
    });

    describe('runOnce', () => {
        it('should load configs and process all includes', async () => {
            const mockConfigs = [{
                include: ['**/*'],
                exclude: [],
                rootDir: cwd,
                agentFile: '/test/cwd/AGENTS.md'
            }];
            mockConfigLoader.loadConfigs.mockResolvedValue(mockConfigs);

            const mockMatches = ['/test/cwd/subdir'];
            (glob.glob as unknown as jest.Mock).mockResolvedValue(mockMatches);

            (fs.lstat as unknown as jest.Mock).mockResolvedValue({
                isDirectory: () => true
            });

            await agentRunner.runOnce();

            expect(mockConfigLoader.loadConfigs).toHaveBeenCalled();
            expect(glob.glob).toHaveBeenCalledWith('**/*', expect.anything());
            expect(mockSymLinker.checkAndLink).toHaveBeenCalledWith(mockMatches[0], [mockConfigs[0]]);
        });
    });

    describe('watch', () => {
        it('should setup chokidar watcher', async () => {
            mockConfigLoader.loadConfigs.mockResolvedValue([]);

            const mockWatcher = {
                on: jest.fn().mockReturnThis()
            };
            (chokidar.watch as jest.Mock).mockReturnValue(mockWatcher);

            await agentRunner.watch();

            expect(chokidar.watch).toHaveBeenCalledWith(cwd, expect.anything());
            expect(mockWatcher.on).toHaveBeenCalledWith('addDir', expect.any(Function));
            expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
            expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
            expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
        });

        it('should refresh all symlinks when .agents file changes', async () => {
            const mockConfigs = [{
                include: ['**/*'],
                exclude: [],
                rootDir: cwd,
                agentFile: '/test/cwd/.agents/AGENTS.md'
            }];
            mockConfigLoader.loadConfigs.mockResolvedValue(mockConfigs);

            const mockMatches = ['/test/cwd/subdir'];
            (glob.glob as unknown as jest.Mock).mockResolvedValue(mockMatches);

            (fs.lstat as unknown as jest.Mock).mockResolvedValue({
                isDirectory: () => true
            });

            const mockWatcher = {
                on: jest.fn().mockReturnThis()
            };
            (chokidar.watch as jest.Mock).mockReturnValue(mockWatcher);

            await agentRunner.watch();

            // Get the 'change' handler
            const changeCallIndex = mockWatcher.on.mock.calls.findIndex(
                call => call[0] === 'change'
            );
            const changeHandler = mockWatcher.on.mock.calls[changeCallIndex][1];

            // Trigger a change in .agents directory
            await changeHandler('/test/cwd/.agents/react-hooks/AGENTS.md');

            // Verify that removeAllLinks was called
            expect(mockSymLinker.removeAllLinks).toHaveBeenCalled();

            // Verify configs were reloaded
            expect(mockConfigLoader.loadConfigs).toHaveBeenCalledTimes(2); // Once on watch(), once on refresh

            // Verify symlinks were reapplied
            expect(mockSymLinker.checkAndLink).toHaveBeenCalled();
        });
    });

    describe('remove', () => {
        it('should use SymLinker.removeAllLinks for robust cleanup (watcher mode)', async () => {
            (mockSymLinker.hasLinks as unknown as jest.Mock).mockReturnValue(true);

            await agentRunner.remove();

            // Should verify we prefer tracking state over re-globbing
            expect(mockSymLinker.removeAllLinks).toHaveBeenCalled();
            // Should NOT rely on globbing for cleanup as configs might have changed/vanished
            expect(glob.glob).not.toHaveBeenCalled();
        });

        it('should fallback to forced removal if no links tracked (CLI --remove)', async () => {
            (mockSymLinker.hasLinks as unknown as jest.Mock).mockReturnValue(false);
            mockConfigLoader.loadConfigs.mockResolvedValue([]);

            await agentRunner.remove();

            expect(mockSymLinker.removeAllLinks).not.toHaveBeenCalled();
            // It calls forceRemoveAll which calls glob (if there were configs)
            // Here configs is empty, so glob not called. 
            // Better to mock configs to ensure glob is called.
            expect(mockConfigLoader.loadConfigs).toHaveBeenCalled();
        });
    });

    describe('conflict handling in runOnce', () => {
        it('should pass ALL matching configs to checkAndLink to enable conflict detection', async () => {
            const mockConfigs = [
                {
                    include: ['**/*'],
                    exclude: [],
                    rootDir: cwd,
                    agentFile: '/test/cwd/AGENTS.md'
                },
                {
                    include: ['**/*'],
                    exclude: [],
                    rootDir: cwd,
                    agentFile: '/test/cwd/other/AGENTS.md'
                }
            ];
            mockConfigLoader.loadConfigs.mockResolvedValue(mockConfigs);

            const mockMatches = ['/test/cwd/subdir'];
            (glob.glob as unknown as jest.Mock).mockResolvedValue(mockMatches);

            (fs.lstat as unknown as jest.Mock).mockResolvedValue({
                isDirectory: () => true
            });

            await agentRunner.runOnce();

            // Should call checkAndLink ONCE for the directory, passing BOTH configs
            // This is crucial for SymLinker to detect the conflict
            expect(mockSymLinker.checkAndLink).toHaveBeenCalledWith(
                mockMatches[0],
                expect.arrayContaining([mockConfigs[0], mockConfigs[1]])
            );
            expect(mockSymLinker.checkAndLink).toHaveBeenCalledTimes(1);
        });
    });
    describe('integration: watch -> remove', () => {
        it('should properly track and remove links when stopped', async () => {
            // Setup robust mocks simulating real behavior
            // We need SymLinker.checkAndLink to ACTUALLY set the hasLinks state in our mock
            // Since SymLinker is mocked, we need to implement the verification logic in the mock

            let linksTracked = false;
            (mockSymLinker.checkAndLink as unknown as jest.Mock).mockImplementation(async () => {
                linksTracked = true;
            });

            (mockSymLinker.hasLinks as unknown as jest.Mock).mockImplementation(() => linksTracked);

            // Setup config and watcher
            mockConfigLoader.loadConfigs.mockResolvedValue([
                { include: ['**/*'], exclude: [], rootDir: cwd, agentFile: 'AGENTS.md' }
            ]);

            const mockWatcher = { on: jest.fn().mockReturnThis() };
            (chokidar.watch as jest.Mock).mockReturnValue(mockWatcher);

            // 1. Start Watch
            await agentRunner.watch();

            // 2. Simulate finding a directory (chokidar 'addDir')
            const addDirHandler = mockWatcher.on.mock.calls.find(call => call[0] === 'addDir')![1];
            await addDirHandler('/test/cwd/subdir');

            // Verify checkAndLink was called and state updated
            expect(mockSymLinker.checkAndLink).toHaveBeenCalled();
            expect(mockSymLinker.hasLinks()).toBe(true);

            // 3. Stop/Remove
            await agentRunner.remove();

            // Verify it used the robust removal path
            expect(mockSymLinker.removeAllLinks).toHaveBeenCalled();
            expect(glob.glob).not.toHaveBeenCalled();
        });
    });

    describe('removeSync (SIGINT-safe)', () => {
        it('should call SymLinker.removeAllLinksSync for signal handler cleanup', () => {
            // removeSync should exist and call the sync method on SymLinker
            agentRunner.removeSync();

            expect(mockSymLinker.removeAllLinksSync).toHaveBeenCalled();
        });

        it('should not use async methods in signal handlers', () => {
            agentRunner.removeSync();

            // Verify we DON'T call the async methods during signal handling
            expect(mockSymLinker.removeAllLinks).not.toHaveBeenCalled();
        });
    });
});

