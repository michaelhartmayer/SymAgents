
import * as fs from 'fs-extra';
import * as path from 'path';
import { AgentRunner } from '../../src/runner';
import { Logger } from '../../src/logger';

export class IntegrationTestContext {
    public tmpDir: string;
    public runner: AgentRunner; // Using any to access private if needed, or public
    private consoleSpy: jest.SpyInstance;

    constructor() {
        // Create a unique temp directory
        const id = Math.random().toString(36).substring(7);
        this.tmpDir = path.resolve(__dirname, '../../.test-tmp', `test-${id}`);
        // We initialize runner later after setup
        this.runner = new AgentRunner(this.tmpDir);
        this.consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        // Also suppress other logs
        jest.spyOn(console, 'warn').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
    }

    async setup() {
        await fs.ensureDir(this.tmpDir);
        // Initialize Runner with the temp cwd
        this.runner = new AgentRunner(this.tmpDir);
    }

    async teardown() {
        // Ensure watcher is stopped
        await this.runner.stop();
        await fs.remove(this.tmpDir);
        jest.restoreAllMocks();
    }

    async createFile(relativePath: string, content: string = '') {
        const fullPath = path.join(this.tmpDir, relativePath);
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content);
        return fullPath;
    }

    async createDir(relativePath: string) {
        const fullPath = path.join(this.tmpDir, relativePath);
        await fs.ensureDir(fullPath);
        return fullPath;
    }

    getFullPath(relativePath: string) {
        return path.join(this.tmpDir, relativePath);
    }
}
