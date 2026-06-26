import { eventBus }                 from '#core/manager/event.js';
import { injectLogErrorEmitter }    from '#core/utils/logger.js';
import { injectUnhandledEmitter }   from '#core/error/index.js';

export function wireErrorBridge(): void {
    injectLogErrorEmitter((payload) => {
        eventBus.emitConcurrent('system.log.error', payload).catch(() => {});
    });

    injectUnhandledEmitter((payload) => {
        eventBus.emitConcurrent('system.error.unhandled', payload).catch(() => {});
    });
}