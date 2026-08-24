import { getLogger } from '#core/utils/logger.js';
import { eventBus } from '#core/manager/events/EventBus.js';
import { upsertErrorOccurrence, listErrorOccurrences, getErrorOccurrenceById, type ErrorListFilter } from './store.js';
import { NovaError } from './NovaError.js';
import type { ErrorOccurrence, ErrorOccurrenceInput } from './types.js';

const log = getLogger('Errors');

export { NovaError } from './NovaError.js';
export type {
    ErrorSeverity,
    ErrorCategory,
    ErrorContext,
    ErrorContextValue,
    ErrorOccurrence,
    ErrorOccurrenceInput,
} from './types.js';

export async function record(input: ErrorOccurrenceInput): Promise<ErrorOccurrence | null> {
    const entry = await upsertErrorOccurrence(input);
    if (!entry) {
        return null;
    }
    void eventBus
        .emit('error.recorded', entry)
        .catch((err: unknown) => {
            const e = err instanceof Error ? err : new Error(String(err));
            log.error(`error.recorded emit failed: ${e.message}`);
        });
    return entry;
}

export async function recordFromError(err: unknown): Promise<ErrorOccurrence | null> {
    if (NovaError.isNovaError(err)) {
        return record({
            code: err.code,
            category: err.category,
            severity: err.severity,
            message: err.userMessage || err.message,
            context: err.details,
        });
    }
    const message = err instanceof Error ? err.message : String(err);
    return record({
        code: 'INTERNAL.UNKNOWN',
        category: 'internal',
        severity: 'error',
        message: message.slice(0, 512),
        context: {},
    });
}

export async function list(filter?: ErrorListFilter): Promise<ErrorOccurrence[]> {
    return listErrorOccurrences(filter ?? {});
}

export async function getById(id: string): Promise<ErrorOccurrence | null> {
    return getErrorOccurrenceById(id);
}

export type { ErrorListFilter } from './store.js';

export const errors = Object.freeze({
    record,
    recordFromError,
    list,
    getById,
});

