import { getLogger } from '#core/utils/logger.js';

const log = getLogger('GlobalCatcher');

export type TeardownHook = () => void | Promise<void>;

export class GlobalErrorCatcher {
    private isInitialized = false;
    private isShuttingDown = false;
    private readonly teardownHooks: TeardownHook[] = [];

    public registerTeardown(hook: TeardownHook): void {
        this.teardownHooks.push(hook);
    }

    public init(): void {
        if (this.isInitialized) return;
        this.isInitialized = true;

        process.on('unhandledRejection', (reason: unknown) => {
            const err = reason instanceof Error ? reason : new Error(String(reason));
            log.error(`[Unhandled Rejection] ${err.message}`, { stack: err.stack });
        });

        process.on('uncaughtException', (error: Error, origin: string) => {
            if (this.isShuttingDown) return; 
            this.isShuttingDown = true;

            log.error(`[Fatal Uncaught Exception] Origin: ${origin} | Msg: ${error.message}`, { stack: error.stack });

            this.executeFatalTeardown();
        });

        log.info('Global Error Catcher active. Fatal errors will trigger a graceful teardown.');
    }

    private async executeFatalTeardown(): Promise<void> {
        log.warn('Initiating emergency teardown sequence...');

        const timeout = setTimeout(() => {
            console.error('Emergency teardown timed out. Force exiting.');
            process.exit(1);
        }, 5000).unref();

        try {
            const promises = this.teardownHooks.map(async (hook) => {
                try {
                    await hook();
                } catch (err) {
                    console.error(`Teardown hook failed: ${(err as Error).message}`);
                }
            });

            await Promise.allSettled(promises);
            log.info('Emergency teardown complete. Process exiting cleanly.');
        } finally {
            clearTimeout(timeout);
            process.exit(1);
        }
    }
}

export const globalCatcher = new GlobalErrorCatcher();