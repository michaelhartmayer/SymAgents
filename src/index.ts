#!/usr/bin/env node
import { AgentRunner } from './runner';
import * as path from 'path';

// Get CWD from args or process.env.INIT_CWD or process.cwd()
const args = process.argv.slice(2);
// Check for commands: --once, --remove
const runOnce = args.includes('--once');
const remove = args.includes('--remove');

// Filter out flags to get potential root arg
const pathArgs = args.filter(arg => !arg.startsWith('--'));

let rootDir = pathArgs[0] ? path.resolve(process.cwd(), pathArgs[0]) : (process.env.INIT_CWD || process.cwd());

console.log(`[SymAgents] Using root directory: ${rootDir}`);
const runner = new AgentRunner(rootDir);

const run = async () => {
    if (remove) {
        await runner.remove();
    } else if (runOnce) {
        await runner.runOnce();
    } else {
        await runner.watch();

        // Handle path cleanup on exit
        const cleanup = async () => {
            console.log('\n[SymAgents] Stopping and cleaning up...');
            try {
                await runner.remove();
            } catch (e) {
                console.error('[SymAgents] Error during cleanup:', e);
            }
            process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    }
};

run().catch(err => {
    console.error('[SymAgents] Fatal error:', err);
    process.exit(1);
});
