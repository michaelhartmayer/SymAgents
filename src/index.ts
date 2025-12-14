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

        // Flag to prevent duplicate cleanup execution
        let cleanupInProgress = false;

        // Handle path cleanup on exit - MUST be synchronous to complete before process exit
        const cleanup = () => {
            // Check if cleanup is already in progress
            if (cleanupInProgress) {
                return;
            }
            cleanupInProgress = true;

            // De-register signal handlers to prevent duplicate calls
            process.off('SIGINT', cleanup);
            process.off('SIGTERM', cleanup);

            Logger.info('\n[SymAgents] Stopping and cleaning up...');
            try {
                // Use SYNCHRONOUS cleanup to ensure it completes before process exits
                runner.removeSync();
                Logger.success('[SymAgents] Done.');
            } catch (e) {
                Logger.error('[SymAgents] Error during cleanup:', e);
            }
            process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    }
};

run().catch(err => {
    Logger.error('[SymAgents] Fatal error:', err);
    process.exit(1);
});
