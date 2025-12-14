import * as fs from 'fs-extra';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { AgentConfig } from './types';
import { Logger } from './logger';

export class SymLinker {
    private cwd: string;
    private linkedDirs: Map<string, AgentConfig> = new Map();

    constructor(cwd: string) {
        this.cwd = cwd;
    }

    hasLinks(): boolean {
        return this.linkedDirs.size > 0;
    }

    async checkAndLink(dirPath: string, configs: AgentConfig[]) {
        // Find all configs that match this directory
        const matchingConfigs: AgentConfig[] = [];

        for (const config of configs) {
            if (this.shouldLink(dirPath, config)) {
                matchingConfigs.push(config);
            }
        }

        if (matchingConfigs.length === 0) {
            return;
        }

        if (matchingConfigs.length > 1) {
            Logger.warn(`[SymAgents] CONFLICT: Directory "${dirPath}" matches multiple configs.`);
            matchingConfigs.forEach((config, index) => {
                Logger.warn(`  ${index + 1}. Pattern from: ${config.rootDir}`);
            });
            Logger.warn(`  Skipping all links to avoid ambiguity/overwriting.`);
            return;
        }

        // Exact one match
        await this.createSymlink(dirPath, matchingConfigs[0]);
    }

    private shouldLink(dirPath: string, config: AgentConfig): boolean {
        const relativePath = path.relative(config.rootDir, dirPath);

        // If outside of config root, ignore
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return false;
        }

        // If it is the config root itself, ignore? (Usually we want subfolders)
        if (relativePath === '') return false;

        // Check excludes first
        if (config.exclude) {
            for (const pattern of config.exclude) {
                if (minimatch(relativePath, pattern)) {
                    return false;
                }
            }
        }

        // Check includes
        if (config.include) {
            for (const pattern of config.include) {
                if (minimatch(relativePath, pattern)) {
                    return true;
                }
            }
        } else {
            // If no include specified, maybe match everything?
            // Or maybe default to nothing?
            // Let's assume if include is missing, we match nothing to be safe, 
            // OR we match everything not excluded.
            // Given the user said "match any of the agent.config files", implicit match all might be dangerous.
            // But usually configs have include. Let's assume include is required OR implies *
            // Let's match * by default if include is undefined?
            return true;
        }

        return false;
    }

    private async createSymlink(targetDir: string, config: AgentConfig) {
        const agentFile = config.agentFile;

        // Register this link
        this.linkedDirs.set(targetDir, config);
        Logger.debug(`[SymAgents] Tracked link for: ${targetDir} (Total: ${this.linkedDirs.size})`);

        const linkPath = path.join(targetDir, 'AGENTS.md');

        try {
            // Check if something exists at linkPath
            const exists = await fs.pathExists(linkPath);
            if (exists) {
                const stats = await fs.lstat(linkPath);
                if (stats.isSymbolicLink()) {
                    // Check where it points
                    const currentTarget = await fs.readlink(linkPath);
                    const absoluteCurrentTarget = path.resolve(targetDir, currentTarget);
                    const absoluteAgentFile = path.resolve(agentFile);

                    if (absoluteCurrentTarget === absoluteAgentFile) {
                        // Already correct
                        return;
                    }
                }
                // If it exists and is not a symlink, or is a wrong symlink, do we overwrite?
                // Maybe warn?
                // User said: "automatically be copied into it" (actually symlinked)
                // Let's not overwrite existing files to be safe, only symlinks?
                // Or maybe overwrite if we are confident.
                if (stats.isSymbolicLink()) {
                    await fs.unlink(linkPath);
                } else {
                    // It's a real file, don't touch
                    // Logger.info(`[SymAgents] Skipping ${linkPath} as it is a real file.`);
                    return;
                }
            }

            // Create relative symlink
            const relativeTarget = path.relative(targetDir, agentFile);
            await fs.ensureSymlink(relativeTarget, linkPath);
            Logger.action(`[SymAgents] Linked AGENTS.md in ${targetDir}`);

        } catch (err) {
            Logger.error(`[SymAgents] Error creating symlink at ${linkPath}:`, err);
        }
    }

    async removeLink(targetDir: string) {
        const linkPath = path.join(targetDir, 'AGENTS.md');
        try {
            // Check if file exists before attempting operations
            if (!(await fs.pathExists(linkPath))) {
                // File doesn't exist, nothing to remove
                this.linkedDirs.delete(targetDir);
                Logger.debug(`[SymAgents] Untracked (missing file): ${targetDir}`);
                return;
            }

            const stats = await fs.lstat(linkPath);
            if (stats.isSymbolicLink()) {
                await fs.unlink(linkPath);
                Logger.action(`[SymAgents] Removed AGENTS.md in ${targetDir}`);
                this.linkedDirs.delete(targetDir);
                Logger.debug(`[SymAgents] Untracked (removed): ${targetDir} (Remaining: ${this.linkedDirs.size})`);
            }
        } catch (err: any) {
            // Handle ENOENT gracefully - file was already removed (race condition)
            if (err.code === 'ENOENT') {
                this.linkedDirs.delete(targetDir);
                return;
            }
            Logger.error(`[SymAgents] Error removing link at ${linkPath}:`, err);
        }
    }

    async removeAllLinks() {
        Logger.info('[SymAgents] Removing all symlinks...');
        const dirs = Array.from(this.linkedDirs.keys());

        // Use Promise.allSettled to handle all removals even if some fail
        const results = await Promise.allSettled(
            dirs.map(dir => this.removeLink(dir))
        );

        // Log any unexpected failures (ENOENT is handled gracefully in removeLink)
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                Logger.error(`[SymAgents] Unexpected error removing link in ${dirs[index]}:`, result.reason);
            }
        });

        this.linkedDirs.clear();
    }

    /**
     * Synchronously removes a symlink from the target directory.
     * Used in signal handlers where async operations may not complete before process exit.
     * @param targetDir - The directory containing the AGENTS.md symlink to remove
     */
    removeLinkSync(targetDir: string): void {
        const linkPath = path.join(targetDir, 'AGENTS.md');
        try {
            if (!fs.existsSync(linkPath)) {
                this.linkedDirs.delete(targetDir);
                return;
            }

            const stats = fs.lstatSync(linkPath);
            if (stats.isSymbolicLink()) {
                fs.unlinkSync(linkPath);
                Logger.action(`[SymAgents] Removed AGENTS.md in ${targetDir}`);
            }
            this.linkedDirs.delete(targetDir);
        } catch (err: any) {
            // Handle ENOENT gracefully - file was already removed (race condition)
            if (err.code === 'ENOENT') {
                this.linkedDirs.delete(targetDir);
                return;
            }
            // Ignore other errors during emergency cleanup to ensure we try all files
        }
    }

    /**
     * Synchronously removes all tracked symlinks.
     * Used in signal handlers (SIGINT/SIGTERM) where async operations may not complete
     * before the process exits. Blocks the main thread until all symlinks are processed.
     */
    removeAllLinksSync(): void {
        Logger.info('[SymAgents] Removing all symlinks...');
        const dirs = Array.from(this.linkedDirs.keys());

        for (const dir of dirs) {
            this.removeLinkSync(dir);
        }

        this.linkedDirs.clear();
    }
}

