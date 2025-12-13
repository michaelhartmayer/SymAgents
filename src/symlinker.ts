import * as fs from 'fs-extra';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { AgentConfig } from './types';

export class SymLinker {
    private cwd: string;
    private linkedDirs: Map<string, AgentConfig> = new Map();

    constructor(cwd: string) {
        this.cwd = cwd;
    }

    async checkAndLink(dirPath: string, configs: AgentConfig[]) {
        // dirPath is absolute
        for (const config of configs) {
            if (this.shouldLink(dirPath, config)) {
                await this.createSymlink(dirPath, config);
            }
        }
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
        // Check for conflicts
        if (this.linkedDirs.has(targetDir)) {
            const existingConfig = this.linkedDirs.get(targetDir)!;
            // If it's a different config object (or same content but different root)
            if (existingConfig !== config) {
                console.warn(`[SymAgents] CONFLICT: Directory "${targetDir}" matches multiple configs.`);
                console.warn(`  1. Pattern from: ${existingConfig.rootDir}`);
                console.warn(`  2. Pattern from: ${config.rootDir}`);
                console.warn(`  Skipping link for config #2 to avoid overwriting.`);
                return;
            }
        }

        // Register this link
        this.linkedDirs.set(targetDir, config);

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
                    // console.log(`[SymAgents] Skipping ${linkPath} as it is a real file.`);
                    return;
                }
            }

            // Create relative symlink
            const relativeTarget = path.relative(targetDir, agentFile);
            await fs.ensureSymlink(relativeTarget, linkPath);
            console.log(`[SymAgents] Linked AGENTS.md in ${targetDir}`);

        } catch (err) {
            console.error(`[SymAgents] Error creating symlink at ${linkPath}:`, err);
        }
    }

    async removeLink(targetDir: string) {
        const linkPath = path.join(targetDir, 'AGENTS.md');
        try {
            if (await fs.pathExists(linkPath)) {
                const stats = await fs.lstat(linkPath);
                if (stats.isSymbolicLink()) {
                    await fs.unlink(linkPath);
                    console.log(`[SymAgents] Removed AGENTS.md in ${targetDir}`);
                    this.linkedDirs.delete(targetDir);
                }
            }
        } catch (err) {
            console.error(`[SymAgents] Error removing link at ${linkPath}:`, err);
        }
    }
}
