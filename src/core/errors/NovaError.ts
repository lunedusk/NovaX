import type { ErrorCategory, ErrorSeverity } from './types.js';

export interface NovaErrorOptions {
    code: string;
    category?: ErrorCategory | string;
    severity?: ErrorSeverity;
    userMessage?: string;
    details?: Record<string, unknown>;
    statusCode?: number;
    cause?: unknown;
}

export class NovaError extends Error {
    readonly code: string;
    readonly category: ErrorCategory | string;
    readonly severity: ErrorSeverity;
    readonly userMessage: string;
    readonly details: Record<string, unknown>;
    readonly statusCode: number | undefined;

    constructor(message: string, options: NovaErrorOptions) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'NovaError';
        this.code = options.code;
        this.category = options.category ?? 'internal';
        this.severity = options.severity ?? 'error';
        this.userMessage = options.userMessage ?? message;
        this.details = options.details ?? {};
        this.statusCode = options.statusCode;
        Object.setPrototypeOf(this, new.target.prototype);
    }

    static isNovaError(err: unknown): err is NovaError {
        return err instanceof NovaError;
    }
}
