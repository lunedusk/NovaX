import { getLogger, flushLogs, isLogsClosed } from '#core/utils/logger.js';

const log = getLogger('CrossHost:WorkerShutdown');

let shuttingDown = false;

export function isWorkerShuttingDown(): boolean {
    return shuttingDown;
}

function safeLog(level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void {
    if (isLogsClosed()) {
        const line = meta !== undefined ? `${message} ${JSON.stringify(meta)}` : message;
        if (level === 'error') log.error(`[CrossHost:WorkerShutdown] ${line}`);
        else log.error(`[CrossHost:WorkerShutdown] ${line}`);
        return;
    }
    try {
        if (level === 'info') log.info(message, meta as never);
        else if (level === 'warn') log.warn(message, meta as never);
        else log.error(message, meta as never);
    } catch {
        log.error(`[CrossHost:WorkerShutdown] ${message}`);
    }
}

export async function performWorkerShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    safeLog('warn', `Worker received ${signal}; beginning full teardown`);

    try {
        const { eventBus } = await import('#core/manager/event.js');
        void eventBus.emitConcurrent('system.shutdown.start', {
            signal,
            role: 'worker',
            at: Date.now(),
        });
    } catch {

    }

    const steps: Array<{ name: string; run: () => Promise<void> }> = [
        {
            name: 'plugin-bus',
            run: async () => {
                try {
                    const { setCrossHostBus } = await import('#core/heart/crossHost.js');
                    setCrossHostBus(null);
                } catch {

                }
            },
        },
        {
            name: 'plugins',
            run: async () => {
                const { pluginManager } = await import('#core/loader/index.js');
                if (typeof pluginManager.shutdownAll === 'function') {
                    await pluginManager.shutdownAll();
                }
            },
        },
        {
            name: 'gateway-clients',
            run: async () => {
                const { getActiveWorkerRuntime } = await import('./adapter.js');
                const rt = getActiveWorkerRuntime();
                if (rt?.shardAdapter) {
                    await rt.shardAdapter.destroyAll();
                }
                if (rt?.grantWaiter) {
                    rt.grantWaiter.clear();
                }
            },
        },
        {
            name: 'http-server',
            run: async () => {
                const { httpServer } = await import('#core/manager/http/server.js');
                if (typeof httpServer.stop === 'function') {
                    await httpServer.stop();
                }
            },
        },
        {
            name: 'databases',
            run: async () => {
                const { DatabaseManager } = await import('#core/database/index.js');
                await DatabaseManager.closeAll();
            },
        },
    ];

    for (const step of steps) {
        try {
            safeLog('info', `Teardown step: ${step.name}`);
            await step.run();
            safeLog('info', `Teardown step complete: ${step.name}`);
        } catch (err) {
            safeLog('warn', `Teardown step failed: ${step.name}`, err);
        }
    }

    try {
        const { eventBus } = await import('#core/manager/event.js');
        void eventBus.emitConcurrent('system.shutdown.complete', {
            signal,
            role: 'worker',
            at: Date.now(),
        });
    } catch {

    }

    safeLog('warn', 'Worker teardown complete; flushing logs and exiting');
    try {
        await flushLogs();
    } catch {

    }
    process.exit(0);
}

export function installWorkerSignalHandlers(): void {
    const onSignal = (signal: string) => {
        void performWorkerShutdown(signal);
    };
    process.on('SIGTERM', () => onSignal('SIGTERM'));
    process.on('SIGINT', () => onSignal('SIGINT'));
}
