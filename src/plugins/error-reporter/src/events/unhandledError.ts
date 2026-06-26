import { BaseEvent } from '#core/bases/Event.js';
import type { UnhandledErrorPayload } from '#core/error/index.js';
import type { ErrorReporterService } from '../utils/errorReporterService.js';

const SERVICE_KEY = Symbol.for('novax.error-reporter.service');

export default class SystemErrorUnhandledEvent extends BaseEvent<[UnhandledErrorPayload]> {
    public readonly name = 'system.error.unhandled';
    public readonly once = false;
    public readonly isSystemEvent = true;

    public async execute(payload: UnhandledErrorPayload): Promise<void> {
        const service = (globalThis as any)[SERVICE_KEY] as ErrorReporterService | undefined;

        if (!service) {
            this.heart.log.warn('ErrorReporterService is currently unavailable.');
            return;
        }

        await service.handleUnhandledError(payload);
    }
}
