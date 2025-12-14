import * as fs from 'fs-extra';
import * as path from 'path';
import * as glob from 'glob';
import * as yaml from 'js-yaml';
import { AgentConfig } from './types';
import { Logger } from './logger';

export class ConfigLoader {
    private cwd: string;

    constructor(cwd: string) {
        this.cwd = cwd;
    }

    async loadConfigs(): Promise<AgentConfig[]> {
        const configs: AgentConfig[] = [];

        // 1. Look for .agents folder
        const dotAgentsPath = path.join(this.cwd, '.agents');
        if (await fs.pathExists(dotAgentsPath)) {
            // Implementation for centralized configs in .agents if needed
            // For now, let's assume .agents might contain Global configs that apply to the whole project
            // But the user said "expects glob patterns any path with agents.config"
        }

        // 2. Scan for agents.config.{json,js,yml,yaml} in the project (excluding .agents)
        const pattern = '**/{agents.config.json,agents.config.js,agents.config.yml,agents.config.yaml}';
        const matches = await glob.glob(pattern, {
            cwd: this.cwd,
            ignore: ['**/node_modules/**', '**/.git/**', '**/.agents/**'], // Ignore .agents to avoid double counting or specific logic
            absolute: true
        });

        // 3. Scan for configs inside .agents (Global configs)
        const globalPattern = '.agents/**/{agents.config.json,agents.config.js,agents.config.yml,agents.config.yaml}';
        const globalMatches = await glob.glob(globalPattern, {
            cwd: this.cwd,
            ignore: ['**/node_modules/**', '**/.git/**'],
            absolute: true
        });

        // Process local matches
        for (const configPath of matches) {
            await this.processConfig(configPath, path.dirname(configPath), configs);
        }

        // Process global matches
        for (const configPath of globalMatches) {
            // Global configs apply to the project root (this.cwd)
            await this.processConfig(configPath, this.cwd, configs);
        }

        return configs;
    }

    private async processConfig(configPath: string, rootDir: string, configs: AgentConfig[]) {
        const configDir = path.dirname(configPath);
        try {
            const configContent = await this.readConfig(configPath);
            if (!configContent) return;

            const configItems = Array.isArray(configContent) ? configContent : [configContent];

            for (const item of configItems) {
                // AGENTS.md is sibling to the config file (default)
                const defaultAgentFile = path.join(configDir, 'AGENTS.md');
                // Resolve configured agentFile relative to configDir, or use default
                const resolvedAgentFile = item.agentFile ? path.resolve(configDir, item.agentFile) : defaultAgentFile;

                if (await fs.pathExists(resolvedAgentFile)) {
                    configs.push({
                        include: item.include,
                        exclude: item.exclude,
                        rootDir: rootDir,
                        agentFile: resolvedAgentFile
                    });
                } else {
                    Logger.warn(`[SymAgents] AGENTS.md not found for config at ${configPath} (looking for ${resolvedAgentFile})`);
                }
            }
        } catch (err) {
            Logger.error(`[SymAgents] Error reading config at ${configPath}:`, err);
        }
    }

    private async readConfig(filePath: string): Promise<any> {
        const ext = path.extname(filePath);
        if (ext === '.json') {
            return await fs.readJson(filePath);
        } else if (ext === '.yml' || ext === '.yaml') {
            const content = await fs.readFile(filePath, 'utf8');
            return yaml.load(content);
        } else if (ext === '.js') {
            // Dynamic import might be tricky in compiled TS, let's try require
            // Warning: this requires the config to be CommonJS or handle ESM correctly
            try {
                return require(filePath);
            } catch (e) {
                Logger.error(`[SymAgents] Could not require .js config: ${filePath}`, e);
                return null;
            }
        }
        return null;
    }
}
