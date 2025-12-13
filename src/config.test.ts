import { ConfigLoader } from './config';
import * as fs from 'fs-extra';
import * as glob from 'glob';
import * as path from 'path';

jest.mock('fs-extra');
jest.mock('glob');

describe('ConfigLoader', () => {
    const cwd = '/test/cwd';
    let configLoader: ConfigLoader;

    beforeEach(() => {
        configLoader = new ConfigLoader(cwd);
        jest.clearAllMocks();
    });

    it('should load configs from local matching files', async () => {
        const mockMatches = ['/test/cwd/src/components/agents.config.json'];
        (glob.glob as unknown as jest.Mock).mockResolvedValueOnce(mockMatches); // Local matches
        (glob.glob as unknown as jest.Mock).mockResolvedValueOnce([]); // Global matches

        (fs.pathExists as jest.Mock).mockImplementation(async (path) => {
            // Mock that AGENTS.md exists
            return true;
        });

        (fs.readJson as jest.Mock).mockResolvedValue({
            include: ['**/*.tsx'],
            exclude: ['**/*.test.tsx'],
            agentFile: './AGENTS.md'
        });

        const configs = await configLoader.loadConfigs();

        expect(configs).toHaveLength(1);
        expect(configs[0]).toEqual({
            include: ['**/*.tsx'],
            exclude: ['**/*.test.tsx'],
            rootDir: '/test/cwd/src/components',
            agentFile: path.resolve('/test/cwd/src/components/AGENTS.md')
        });
    });

    it('should handle global configs in .agents', async () => {
        const mockGlobalMatches = ['/test/cwd/.agents/my-agent/agents.config.json'];
        (glob.glob as unknown as jest.Mock).mockResolvedValueOnce([]); // Local matches
        (glob.glob as unknown as jest.Mock).mockResolvedValueOnce(mockGlobalMatches); // Global matches

        (fs.pathExists as jest.Mock).mockResolvedValue(true);
        (fs.readJson as jest.Mock).mockResolvedValue({
            include: ['src/**/*.ts'],
            agentFile: 'AGENTS.md'
        });

        const configs = await configLoader.loadConfigs();

        expect(configs).toHaveLength(1);
        expect(configs[0].rootDir).toBe(cwd); // Global config applies to root
        expect(configs[0].agentFile).toBe(path.resolve('/test/cwd/.agents/my-agent/AGENTS.md'));
    });
});
