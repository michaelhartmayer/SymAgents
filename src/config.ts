import * as fs from 'fs-extra';
import * as path from 'path';
import * as glob from 'glob';
import * as yaml from 'js-yaml';
import { AgentConfig } from './types';

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
            if (configContent) {
                // AGENTS.md is sibling to the config file
                const agentFile = path.join(configDir, 'AGENTS.md');

                if (await fs.pathExists(configContent.agentFile ? path.resolve(configDir, configContent.agentFile) : agentFile)) {
                    configs.push({
                        include: configContent.include,
                        exclude: configContent.exclude,
                        rootDir: rootDir,
                        agentFile: configContent.agentFile ? path.resolve(configDir, configContent.agentFile) : agentFile
                    });
                } else {
                    console.warn(`[SymAgents] AGENTS.md not found for config at ${configPath}`);
                }
            }
        } catch (err) {
            console.error(`[SymAgents] Error reading config at ${configPath}:`, err);
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
                console.error(`[SymAgents] Could not require .js config: ${filePath}`, e);
                return null;
            }
        }
        return null;
    }
}
