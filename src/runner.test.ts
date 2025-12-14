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
});
