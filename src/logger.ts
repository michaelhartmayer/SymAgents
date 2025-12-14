import chalk from 'chalk';

/**
 * Logger utility for SymAgents with color-coded output
 */
export class Logger {
    /**
     * Log informational message (cyan)
     */
    static info(message: string): void {
        console.log(chalk.cyan(message));
    }

    /**
     * Log success message (green)
     */
    static success(message: string): void {
        console.log(chalk.green(message));
    }

    /**
     * Log warning message (yellow)
     */
    static warn(message: string): void {
        console.warn(chalk.yellow(message));
    }

    /**
     * Log error message (red)
     */
    static error(message: string, error?: any): void {
        console.error(chalk.red(message));
        if (error) {
            console.error(chalk.red(error));
        }
    }

    /**
     * Log action message (blue) - for linking/removing operations
     */
    static action(message: string): void {
        console.log(chalk.blue(message));
    }
}
