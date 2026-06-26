import { BaseEvent } from '#core/bases/Event.js';
import type { LogErrorPayload } from '#core/utils/logger.js';
import type { ErrorReporterService } from '../utils/errorReporterService.js';

const SERVICE_KEY = Symbol.for('novax.error-reporter.service');

export default class SystemLogErrorEvent extends BaseEvent<[LogErrorPayload]> {
    public readonly name = 'system.log.error';
    public readonly once = false;
    public readonly isSystemEvent = true;

    public async execute(payload: LogErrorPayload): Promise<void> {
        const service = (globalThis as any)[SERVICE_KEY] as ErrorReporterService | undefined;
        
        if (!service) {
            this.heart.log.warn('ErrorReporterService is currently unavailable.');
            return;
        }

        await service.handleLogError(payload);
    }
}