export class PathAllowError extends Error {
    constructor(
        message: string,
        public readonly code: 'traversal' | 'invalid' | 'not_allowed',
    ) {
        super(message);
    }
}

export function normalizeApiPath(input: string): string {
    if (typeof input !== 'string' || input.length === 0) {
        throw new PathAllowError('empty path', 'invalid');
    }
    let raw = input.trim();
    if (!raw.startsWith('/')) {
        raw = `/${raw}`;
    }
    let decoded = raw;
    for (let i = 0; i < 3; i++) {
        try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        } catch {
            throw new PathAllowError('malformed percent-encoding', 'invalid');
        }
    }
    if (decoded.includes('\0')) {
        throw new PathAllowError('null byte in path', 'invalid');
    }
    if (/[\\]/.test(decoded)) {
        throw new PathAllowError('backslash in path', 'invalid');
    }
    const parts = decoded.split('/');
    const stack: string[] = [];
    for (const part of parts) {
        if (part === '' || part === '.') continue;
        if (part === '..') {
            throw new PathAllowError('path traversal', 'traversal');
        }
        if (part.includes('/') || part.includes('\\')) {
            throw new PathAllowError('illegal segment', 'invalid');
        }
        stack.push(part);
    }
    return `/${stack.join('/')}`;
}

export function pathMatchesAllowPattern(normalizedPath: string, pattern: string): boolean {
    const trimmed = pattern.trim();
    const isWildcard = trimmed.endsWith('/*') || (trimmed.endsWith('*') && !trimmed.endsWith('/*'));
    let patternBase = trimmed;
    if (trimmed.endsWith('/*')) {
        patternBase = trimmed.slice(0, -2);
    } else if (trimmed.endsWith('*')) {
        patternBase = trimmed.slice(0, -1);
    }
    const normPattern = normalizeApiPath(patternBase);
    const pathSegs = normalizedPath.split('/').filter(Boolean);
    const patternSegs = normPattern.split('/').filter(Boolean);

    if (!isWildcard) {
        if (pathSegs.length !== patternSegs.length) return false;
        return pathSegs.every((s, i) => s === patternSegs[i]);
    }

    if (pathSegs.length < patternSegs.length) return false;
    for (let i = 0; i < patternSegs.length; i++) {
        if (pathSegs[i] !== patternSegs[i]) return false;
    }
    return true;
}

export function assertPathAllowed(rawPath: string, patterns: readonly string[]): string {
    const normalized = normalizeApiPath(rawPath);
    for (const p of patterns) {
        if (pathMatchesAllowPattern(normalized, p)) {
            return normalized;
        }
    }
    throw new PathAllowError('path not on allowlist', 'not_allowed');
}

export function patternsForPlugin(pluginId: string): string[] {
    const id = pluginId.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!id || id !== pluginId) {
        throw new PathAllowError('invalid pluginId', 'invalid');
    }
    return [`/api/dash/plugins/${id}`, `/api/dash/plugins/${id}/*`];
}
