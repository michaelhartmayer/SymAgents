import * as chokidar from 'chokidar';
import * as path from 'path';
import * as glob from 'glob';
import * as fs from 'fs-extra';
import { ConfigLoader } from './config';
import { SymLinker } from './symlinker';
import { AgentConfig } from './types';
import { Logger } from './logger';

export class AgentRunner {
    private cwd: string;
    private configLoader: ConfigLoader;
    private symLinker: SymLinker;
    private configs: AgentConfig[] = [];
    private isRefreshing: boolean = false;

    constructor(cwd: string) {
        this.cwd = cwd;
        this.configLoader = new ConfigLoader(cwd);
        this.symLinker = new SymLinker(cwd);
    }

    async watch() {
        Logger.info('[SymAgents] Starting watcher...');
        await this.reloadConfigs();

        const watcher = chokidar.watch(this.cwd, {
            ignored: /(^|[\/\\])\.\.|node_modules/,
            persistent: true,
            ignoreInitial: false,
            depth: 99
        });

        watcher
            .on('addDir', (path) => this.onDirAdd(path))
            .on('add', (path) => this.onFileAdd(path))
            .on('change', (path) => this.onFileChange(path))
            .on('unlink', (path) => this.onFileUnlink(path));

        Logger.success('[SymAgents] Watching for changes...');
    }

    async runOnce() {
        Logger.info('[SymAgents] Running once...');
        await this.reloadConfigs();
        await this.processAll('link');
        Logger.success('[SymAgents] Done.');
    }

    async remove() {
        Logger.info('[SymAgents] Removing symlinks...');
        await this.reloadConfigs();
        await this.processAll('remove');
        Logger.success('[SymAgents] Done.');
    }

    private async processAll(action: 'link' | 'remove') {
        for (const config of this.configs) {
            if (!config.include) continue;

            for (const pattern of config.include) {
                try {
                    // Find all matches
                    const matches = await glob.glob(pattern, {
                        cwd: config.rootDir,
                        ignore: config.exclude,
                        absolute: true
                    });

                    for (const matchPath of matches) {
                        const stats = await fs.lstat(matchPath);
                        if (stats.isDirectory()) {
                            if (action === 'link') {
                                await this.symLinker.checkAndLink(matchPath, [config]);
                            } else {
                                await this.symLinker.removeLink(matchPath);
                            }
                        }
                    }
                } catch (err) {
                    Logger.error(`[SymAgents] Error processing pattern ${pattern} in ${config.rootDir}:`, err);
                }
            }
        }
    }

    private async reloadConfigs() {
        Logger.info('[SymAgents] Loading configurations...');
        this.configs = await this.configLoader.loadConfigs();
        Logger.success(`[SymAgents] Loaded ${this.configs.length} configs.`);
    }

    private async refreshAllSymlinks() {
        if (this.isRefreshing) {
            return; // Avoid recursive refresh
        }

        this.isRefreshing = true;
        try {
            Logger.info('[SymAgents] .agents directory changed, refreshing all symlinks...');

            // Remove all existing symlinks
            await this.symLinker.removeAllLinks();

            // Reload configs
            await this.reloadConfigs();

            // Reapply all symlinks
            await this.processAll('link');

            Logger.success('[SymAgents] Symlinks refreshed.');
        } finally {
            this.isRefreshing = false;
        }
    }

    private async onDirAdd(dirPath: string) {
        if (this.isRefreshing) return;
        await this.symLinker.checkAndLink(dirPath, this.configs);
    }

    private async onFileAdd(filePath: string) {
        if (this.isRefreshing) return;

        if (this.isAgentsFile(filePath)) {
            await this.refreshAllSymlinks();
        } else if (this.isConfigFile(filePath)) {
            await this.reloadConfigs();
        }
    }

    private async onFileChange(filePath: string) {
        if (this.isRefreshing) return;

        if (this.isAgentsFile(filePath)) {
            await this.refreshAllSymlinks();
        } else if (this.isConfigFile(filePath)) {
            await this.reloadConfigs();
        }
    }

    private async onFileUnlink(filePath: string) {
        if (this.isRefreshing) return;

        if (this.isAgentsFile(filePath)) {
            await this.refreshAllSymlinks();
        } else if (this.isConfigFile(filePath)) {
            await this.reloadConfigs();
        }
    }

    private isConfigFile(filePath: string): boolean {
        const filename = path.basename(filePath);
        return filename.startsWith('agents.config.');
    }

    private isAgentsFile(filePath: string): boolean {
        const relativePath = path.relative(this.cwd, filePath);
        return relativePath.startsWith('.agents' + path.sep) || relativePath === '.agents';
    }
}
