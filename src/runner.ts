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
        await this.applyAllLinks();
        Logger.success('[SymAgents] Done.');
    }

    async remove() {
        Logger.info('[SymAgents] Removing symlinks...');
        // We don't need to reload configs to remove. We rely on what SymLinker tracks.
        // But if this is a fresh run (CLI --remove), tracking map is empty.
        // Wait, if it's CLI --remove, we have no memory.
        // So we MUST reload configs and find what matches to remove it?
        // OR we just assume removeAllLinks only works for active watcher?

        // If CLI --remove is used:
        // "npx sym-agents --remove" -> runner starts fresh.
        // symLinker.linkedDirs is empty.
        // removeAllLinks does nothing.

        // So for "CLI remove", we DO need to find files.
        // But the bug report was "stopping the watcher".
        // When watcher is running, linkedDirs IS populated.

        // So we need dual strategy?
        // 1. If we have tracked links, remove them using removeAllLinks
        // 2. If we are starting fresh (and want to clean up potential stale links?), we usually scan.
        // But "removeAllLinks" fails if we don't know them.

        // Let's look at `index.ts`:
        // const run = async () => { if (remove) await runner.remove(); ... }
        // This is fresh start.

        // But cleanup() in index.ts:
        // const cleanup = async () => { ... await runner.remove(); ... }
        // This uses the SAME runner instance (populated).

        // So:
        if (this.symLinker.hasLinks()) {
            // We have memory (watcher case)
            await this.symLinker.removeAllLinks();
        } else {
            // We have no memory (CLI --remove case), we must scan.
            // But scanning requires GLOB.
            // And scanning logic was what we had before (processAll('remove')).
            // But processAll('remove') calls removeLink, which relies on tracking map?
            // No, removeLink implementation:
            // if (!pathExists) ...
            // if (isSymlink) unlink.
            // It does NOT require it to be in the map (unless it checks?).
            // symlinker.ts: removeLink(targetDir) -> check path, unlink if symlink.
            // It deletes from map, but doesn't require it to be there to unlink.

            // So for CLI --remove, we need to scan.
            // For Watcher Cleanup, we prefer removeAllLinks (from map).

            await this.reloadConfigs();
            await this.forceRemoveAll();
        }

        Logger.success('[SymAgents] Done.');
    }

    private async applyAllLinks() {
        const uniqueDirs = new Set<string>();

        // Gather all matched directories from all configs
        for (const config of this.configs) {
            if (!config.include) continue;

            for (const pattern of config.include) {
                try {
                    const matches = await glob.glob(pattern, {
                        cwd: config.rootDir,
                        ignore: config.exclude,
                        absolute: true
                    });

                    for (const matchPath of matches) {
                        const stats = await fs.lstat(matchPath);
                        if (stats.isDirectory()) {
                            uniqueDirs.add(matchPath);
                        }
                    }
                } catch (err) {
                    Logger.error(`[SymAgents] Error processing pattern ${pattern} in ${config.rootDir}:`, err);
                }
            }
        }

        // Process each unique directory with ALL configs to enable conflict detection
        for (const dirPath of uniqueDirs) {
            await this.symLinker.checkAndLink(dirPath, this.configs);
        }
    }

    private async forceRemoveAll() {
        // Fallback for CLI --remove or if map is empty
        // Re-glob everything and try to remove
        const uniqueDirs = new Set<string>();

        for (const config of this.configs) {
            if (!config.include) continue;
            for (const pattern of config.include) {
                try {
                    const matches = await glob.glob(pattern, {
                        cwd: config.rootDir,
                        ignore: config.exclude,
                        absolute: true
                    });
                    for (const match of matches) {
                        const stats = await fs.lstat(match);
                        if (stats.isDirectory()) uniqueDirs.add(match);
                    }
                } catch (e) { }
            }
        }

        for (const dir of uniqueDirs) {
            await this.symLinker.removeLink(dir);
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
            await this.applyAllLinks();

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
