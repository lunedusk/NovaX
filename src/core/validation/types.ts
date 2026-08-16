export type ValidationKind = 'common' | 'config' | 'lang' | 'data';

export type ValidationIssueCode = 'parse' | 'schema' | 'rules' | 'io';

export interface ValidationIssue {
    code: ValidationIssueCode;
    message: string;
    path?: string;
}

export interface ValidationContext {
    kind: ValidationKind;
    filePath: string;
    name?: string;
    pluginId?: string | null;
    locale?: string | null;
    namespace?: string | null;
}

export interface ValidationSuccess<T = unknown> {
    ok: true;
    data: T;
    issues: ValidationIssue[];
}

export interface ValidationFailure {
    ok: false;
    data?: unknown;
    issues: ValidationIssue[];
}

export type ValidationResult<T = unknown> = ValidationSuccess<T> | ValidationFailure;

export type RulesValidateFn = (
    data: unknown,
    ctx: ValidationContext
) => boolean | string | string[] | Promise<boolean | string | string[]>;
