export type ErrorSeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type ErrorCategory =
    | 'auth'
    | 'token'
    | 'permission'
    | 'gateway'
    | 'validation'
    | 'internal'
    | 'db'
    | 'plugin'
    | 'http'
    | 'unknown';

export type ErrorContextValue = string | number | boolean | null;

export type ErrorContext = Record<string, ErrorContextValue>;

export interface ErrorOccurrenceInput {
    code: string;
    category: ErrorCategory | string;
    severity: ErrorSeverity;
    message: string;
    context?: Record<string, unknown>;
}

export interface ErrorOccurrence {
    id: string;
    code: string;
    category: string;
    severity: ErrorSeverity;
    message: string;
    context: ErrorContext;
    count: number;
    firstSeen: number;
    lastSeen: number;
}
