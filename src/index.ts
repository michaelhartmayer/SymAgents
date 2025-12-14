#!/usr/bin/env node
import { AgentRunner } from './runner';
import * as path from 'path';
import { Logger } from './logger';

// Get CWD from args or process.env.INIT_CWD or process.cwd()
const args = process.argv.slice(2);
// Check for commands: --once, --remove
const runOnce = args.includes('--once');
const remove = args.includes('--remove');

// Filter out flags to get potential root arg
const pathArgs = args.filter(arg => !arg.startsWith('--'));

let rootDir = pathArgs[0] ? path.resolve(process.cwd(), pathArgs[0]) : (process.env.INIT_CWD || process.cwd());

Logger.info(`[SymAgents] Using root directory: ${rootDir}`);
const runner = new AgentRunner(rootDir);

const run = async () => {
    if (remove) {
        await runner.remove();
    } else if (runOnce) {
        await runner.runOnce();
    } else {
        await runner.watch();

        // Keep event loop alive for proper signal handling under npm scripts
        // This is critical - npm wraps scripts in a shell that may not forward signals
        // properly unless the event loop is active
        process.stdin.resume();

        // Guard to prevent double-cleanup if multiple signals arrive
        let hasCleanedUp = false;

        // Synchronous cleanup function - must complete before process exits
        const cleanupSync = () => {
            if (hasCleanedUp) return;
            hasCleanedUp = true;
            try {
                runner.removeSync();
            } catch (e) {
                Logger.error('[SymAgents] Error during cleanup:', e);
            }
        };

        // Graceful shutdown handler for signals
        const gracefulShutdown = (signal: string) => {
            Logger.info(`\n[SymAgents] Received ${signal}, cleaning up...`);
            cleanupSync();
            Logger.success('[SymAgents] Done.');
            process.exit(0);
        };

        // Handle all common termination signals
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

        // Last resort backup - catches cases where:
        // - npm/shell kills the process
        // - Signal handler started but process.exit got interrupted
        // - Any other abnormal termination
        // The 'exit' event fires after signal handlers but before process terminates
        process.on('exit', cleanupSync);
    }
};

run().catch(err => {
    Logger.error('[SymAgents] Fatal error:', err);
    process.exit(1);
});
