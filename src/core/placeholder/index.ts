import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { secrets } from '#core/helpers/secretManager.js';
import { getLogger } from '#core/utils/logger.js';
import {
    parseSharedRandBody,
    resolveSharedBootRand,
    isSharedBootValue,
} from '#core/placeholder/sharedBootRand.js';

function tryGetCorePlaceholdersSync(): PlaceholderMap {
    try {
        const hook = (globalThis as { __novaxConfigPlaceholders?: () => unknown }).__novaxConfigPlaceholders;
        if (typeof hook === 'function') {
            return flattenPlaceholders(hook());
        }
    } catch {
        
    }
    return {};
}

function tryGetEmojisSync(): Record<string, string> {
    try {
        const hook = (globalThis as { __novaxEmojisGetAll?: () => Record<string, string> }).__novaxEmojisGetAll;
        if (typeof hook === 'function') return hook();
    } catch {
        
    }
    return {};
}

const log = getLogger('Placeholder');

const DOLLAR_PLACEHOLDER_RE =
    /\$\{(env|secret|rand):([^}]+)\}/g;

const PERCENT_PLACEHOLDER_RE = /%%([a-zA-Z0-9_.-]+)%%/g;

export type PlaceholderMap = Record<string, string>;

export interface ExpandOptions {
    failClosed?: boolean;
    resolveEmoji?: boolean;
    collectUntaggedRand?: boolean;
    softMiss?: 'absent' | 'empty';
}

export interface ExpandResult<T> {
    value: T;
    untaggedRandPersists: Map<string, string>;
    hadUnresolvedRequired: boolean;
}

const ABSENT = Symbol('placeholder.absent');

const taggedRandCache = new Map<string, string>();

function isProduction(): boolean {
    const env = process.env.NODE_ENV?.trim().toLowerCase();
    return !env || env === 'production';
}

function flattenPlaceholders(source: unknown, prefix = '', output: PlaceholderMap = {}): PlaceholderMap {
    if (!source || typeof source !== 'object') {
        return output;
    }

    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
        const nextKey = prefix ? `${prefix}.${key}` : key;

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            flattenPlaceholders(value, nextKey, output);
            continue;
        }

        if (value !== undefined && value !== null) {
            output[nextKey] = String(value);
            if (!prefix) {
                output[key] = String(value);
            }
        }
    }

    return output;
}

export function buildPercentPlaceholderMap(resolveEmoji: boolean): PlaceholderMap {
    const customPlaceholders = tryGetCorePlaceholdersSync();
    const map: PlaceholderMap = { ...customPlaceholders };

    if (resolveEmoji) {
        for (const [name, value] of Object.entries(tryGetEmojisSync())) {
            map[`emoji_${name}`] = value;
        }
    }

    return map;
}

export function registerConfigPlaceholderSource(getPlaceholders: () => unknown): void {
    (globalThis as { __novaxConfigPlaceholders?: () => unknown }).__novaxConfigPlaceholders = getPlaceholders;
}

export function registerEmojiSource(getAll: () => Record<string, string>): void {
    (globalThis as { __novaxEmojisGetAll?: () => Record<string, string> }).__novaxEmojisGetAll = getAll;
}

function generateRand(encoding: string, byteLength: number): string {
    const n = Math.max(1, Math.min(byteLength, 1024));
    const buf = randomBytes(n);
    if (encoding === 'hex') {
        return buf.toString('hex');
    }
    if (encoding === 'base64' || encoding === 'base64url') {
        return buf.toString(encoding === 'base64url' ? 'base64url' : 'base64');
    }
    return buf.toString('hex');
}

function parseRandBody(body: string): {
    encoding: string;
    length: number;
    tag: string | null;
    shared: boolean;
    sharedName: string | null;
} | null {
    const sharedSpec = parseSharedRandBody(body);
    if (sharedSpec) {
        return {
            encoding: sharedSpec.encoding,
            length: sharedSpec.length,
            tag: null,
            shared: true,
            sharedName: sharedSpec.name,
        };
    }

    const hashIdx = body.indexOf('#');
    const main = hashIdx >= 0 ? body.slice(0, hashIdx) : body;
    const tag = hashIdx >= 0 ? body.slice(hashIdx + 1) : null;
    const parts = main.split(':');
    if (parts.length < 2) return null;
    const encoding = parts[0].toLowerCase();
    const length = parseInt(parts[1], 10);
    if (!Number.isFinite(length) || length <= 0) return null;
    return {
        encoding,
        length,
        tag: tag && tag.length > 0 ? tag : null,
        shared: false,
        sharedName: null,
    };
}

function resolveEnvOrSecret(
    kind: 'env' | 'secret',
    keyWithOptional: string,
    softMiss: 'absent' | 'empty',
): { ok: true; value: string | typeof ABSENT } | { ok: false; optional: boolean; key: string } {
    const optional = keyWithOptional.endsWith('?');
    const key = optional ? keyWithOptional.slice(0, -1) : keyWithOptional;

    if (!key) {
        return { ok: false, optional, key };
    }

    let value: string | undefined;
    if (secrets.has(key)) {
        value = secrets.getOptional(key);
    } else if (process.env[key] !== undefined && process.env[key] !== '') {
        value = process.env[key];
    }

    if (value !== undefined) {
        return { ok: true, value };
    }

    if (optional) {
        return { ok: true, value: softMiss === 'empty' ? '' : ABSENT };
    }

    return { ok: false, optional: false, key };
}

function expandString(
    input: string,
    options: ExpandOptions,
    untaggedRandPersists: Map<string, string>,
    state: { hadUnresolvedRequired: boolean },
): string | typeof ABSENT {
    const failClosed = options.failClosed ?? isProduction();
    const softMiss = options.softMiss ?? 'absent';
    const resolveEmoji = options.resolveEmoji ?? false;
    const collectUntaggedRand = options.collectUntaggedRand ?? false;

    let result = input;
    let onlyAbsent = false;

    result = result.replace(DOLLAR_PLACEHOLDER_RE, (full, kind: string, body: string) => {
        if (kind === 'env' || kind === 'secret') {
            const resolved = resolveEnvOrSecret(kind, body, softMiss);
            if (resolved.ok) {
                if (resolved.value === ABSENT) {
                    if (input.trim() === full) {
                        onlyAbsent = true;
                    }
                    return '';
                }
                return resolved.value;
            }
            state.hadUnresolvedRequired = true;
            if (failClosed) {
                throw new Error(
                    `Placeholder unresolved: \${${kind}:${resolved.key}} (required). ` +
                        `Set the key in the environment / secrets vault, or use \${${kind}:${resolved.key}?} for optional.`,
                );
            }
            log.warn(`Unresolved placeholder \${${kind}:${resolved.key}} — leaving token in place (non-production).`);
            return full;
        }

        const parsed = parseRandBody(body);
        if (!parsed) {
            state.hadUnresolvedRequired = true;
            if (failClosed) {
                throw new Error(`Invalid rand placeholder: ${full}`);
            }
            log.warn(`Invalid rand placeholder ${full}`);
            return full;
        }

        if (parsed.shared) {
            return resolveSharedBootRand({
                encoding: parsed.encoding,
                length: parsed.length,
                name: parsed.sharedName ?? '_',
            });
        }

        if (parsed.tag !== null) {
            const cacheKey = `${parsed.encoding}:${parsed.length}#${parsed.tag}`;
            let cached = taggedRandCache.get(cacheKey);
            if (cached === undefined) {
                cached = generateRand(parsed.encoding, parsed.length);
                taggedRandCache.set(cacheKey, cached);
            }
            return cached;
        }

        const value = generateRand(parsed.encoding, parsed.length);

        if (collectUntaggedRand) {
            untaggedRandPersists.set(full, value);
        }

        return value;
    });

    if (onlyAbsent && result === '') {
        return ABSENT;
    }

    const percentMap = buildPercentPlaceholderMap(resolveEmoji);
    result = result.replace(PERCENT_PLACEHOLDER_RE, (full, key: string) => {
        const normalizedKey = key.startsWith('placeholder_') ? key.slice('placeholder_'.length) : key;

        if (!resolveEmoji && (normalizedKey.startsWith('emoji_') || key.startsWith('emoji_'))) {
            return full;
        }

        return percentMap[normalizedKey] ?? percentMap[key] ?? full;
    });

    return result;
}

export function expandValue<T>(input: T, options: ExpandOptions = {}): ExpandResult<T> {
    const untaggedRandPersists = new Map<string, string>();
    const state = { hadUnresolvedRequired: false };

    const walk = (target: unknown): unknown => {
        if (typeof target === 'string') {
            const expanded = expandString(target, options, untaggedRandPersists, state);
            if (expanded === ABSENT) return undefined;
            return expanded;
        }

        if (Array.isArray(target)) {
            return target.map((item) => walk(item)).filter((item) => item !== undefined);
        }

        if (target !== null && typeof target === 'object') {
            if (Object.getPrototypeOf(target) !== Object.prototype && !(target.constructor === Object)) {
                return target;
            }
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(target as Record<string, unknown>)) {
                const next = walk(v);
                if (next !== undefined) {
                    out[k] = next;
                }
            }
            return out;
        }

        return target;
    };

    const value = walk(input) as T;
    return {
        value,
        untaggedRandPersists,
        hadUnresolvedRequired: state.hadUnresolvedRequired,
    };
}

export function resolveGlobalPlaceholders<T>(obj: T): T {
    const { value } = expandValue(obj, {
        failClosed: false,
        resolveEmoji: true,
        collectUntaggedRand: false,
        softMiss: 'absent',
    });
    return value;
}

export function interpolateVariables<T>(obj: T, vars?: Record<string, unknown>): T {
    if (!vars || Object.keys(vars).length === 0) {
        return resolveGlobalPlaceholders(obj);
    }

    const replace = (target: unknown): unknown => {
        if (typeof target === 'string') {
            const interpolated = target.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
                const val = key.split('.').reduce<unknown>((o, p) => {
                    if (o !== null && typeof o === 'object' && p in (o as Record<string, unknown>)) {
                        return (o as Record<string, unknown>)[p];
                    }
                    return undefined;
                }, vars);
                return val !== undefined ? String(val) : `{{${key}}}`;
            });
            return resolveGlobalPlaceholders(interpolated);
        }

        if (Array.isArray(target)) {
            return target.map(replace);
        }

        if (target !== null && typeof target === 'object') {
            if (Object.getPrototypeOf(target) !== Object.prototype && !(target.constructor === Object)) {
                return target;
            }
            const res: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(target as Record<string, unknown>)) {
                res[k] = replace(v);
            }
            return res;
        }

        return target;
    };

    return replace(obj) as T;
}

export function expandProcessEnv(options: ExpandOptions = {}): {
    expandedKeys: string[];
    untaggedRandPersists: Map<string, string>;
} {
    const maxPasses = 8;
    const expandedKeys: string[] = [];
    const allPersists = new Map<string, string>();
    const opts: ExpandOptions = {
        failClosed: options.failClosed ?? isProduction(),
        resolveEmoji: false,
        collectUntaggedRand: options.collectUntaggedRand ?? true,
        softMiss: options.softMiss ?? 'absent',
    };

    const readRaw = (key: string): string | undefined => {
        if (secrets.has(key)) return secrets.getOptional(key);
        return process.env[key];
    };

    const writeExpanded = (key: string, value: string): void => {
        process.env[key] = value;
        try {
            secrets.set(key, value);
        } catch {
            process.env[key] = value;
        }
    };

    for (let pass = 0; pass < maxPasses; pass++) {
        let changed = false;
        const keys = new Set<string>([...Object.keys(process.env), ...secrets.keys()]);

        for (const key of keys) {
            const raw = readRaw(key);
            if (raw === undefined || raw === '') continue;
            if (!raw.includes('${') && !raw.includes('%%')) continue;

            try {
                const { value, untaggedRandPersists, hadUnresolvedRequired } = expandValue(raw, opts);
                for (const [k, v] of untaggedRandPersists) allPersists.set(k, v);

                if (typeof value === 'string' && value !== raw) {
                    writeExpanded(key, value);
                    if (!expandedKeys.includes(key)) expandedKeys.push(key);
                    changed = true;
                } else if (value === undefined && opts.softMiss === 'absent') {
                    writeExpanded(key, '');
                    if (!expandedKeys.includes(key)) expandedKeys.push(key);
                    changed = true;
                }

                if (hadUnresolvedRequired && !(opts.failClosed ?? isProduction())) {
                    log.warn(`Env key [${key}] still has unresolved required placeholders after pass ${pass + 1}.`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log.error(`Env placeholder expansion failed for [${key}]: ${message}`);
                throw err;
            }
        }
        if (!changed) break;
    }

    if (allPersists.size > 0) {
        persistUntaggedRandInEnvFiles(allPersists);
    }

    return { expandedKeys, untaggedRandPersists: allPersists };
}

function envFilePaths(): string[] {
    return [path.join(process.cwd(), '.env'), path.join(process.cwd(), '.env.local')];
}

export function persistUntaggedRandInEnvFiles(persists: Map<string, string>): void {
    if (persists.size === 0) return;
    for (const filePath of envFilePaths()) {
        if (!fs.existsSync(filePath)) continue;
        let content = fs.readFileSync(filePath, 'utf-8');
        let changed = false;
        for (const [placeholder, value] of persists) {
            if (content.includes(placeholder)) {
                content = content.split(placeholder).join(value);
                changed = true;
            }
        }
        if (changed) {
            fs.writeFileSync(filePath, content, 'utf-8');
            log.info(`Persisted untagged env rand in ${filePath}`);
        }
    }
}

export function applyUntaggedRandPersists<T>(raw: T, persists: Map<string, string>): T {
    if (persists.size === 0) return raw;

    const walk = (target: unknown): unknown => {
        if (typeof target === 'string') {
            let s = target;
            for (const [placeholder, value] of persists) {
                if (s.includes(placeholder)) {
                    s = s.split(placeholder).join(value);
                }
            }
            return s;
        }
        if (Array.isArray(target)) return target.map(walk);
        if (target !== null && typeof target === 'object') {
            if (Object.getPrototypeOf(target) !== Object.prototype && !(target.constructor === Object)) {
                return target;
            }
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(target as Record<string, unknown>)) {
                out[k] = walk(v);
            }
            return out;
        }
        return target;
    };

    return walk(raw) as T;
}

export function redactExpandedForApi(value: unknown): unknown {
    const sensitiveKey = /(pass(word|code)?|token|secret|api[-_]?key|authorization|auth|cookie|session|credential|bearer|private[-_]?key|uri|dsn|connectionstring)/i;

    const walk = (node: unknown, keyHint?: string): unknown => {
        if (node === null || node === undefined) return node;
        if (typeof node === 'string') {
            if (isSharedBootValue(node)) return '***';
            if (keyHint && sensitiveKey.test(keyHint)) return '***';
            if (node.length > 24 && /^[A-Za-z0-9+/=_-]+$/.test(node) && sensitiveKey.test(keyHint ?? '')) {
                return '***';
            }
            return node;
        }
        if (typeof node !== 'object') return node;
        if (Array.isArray(node)) return node.map((item) => walk(item, keyHint));
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            if (typeof v === 'string' && isSharedBootValue(v)) {
                out[k] = '***';
            } else if (sensitiveKey.test(k) && typeof v === 'string') {
                out[k] = '***';
            } else {
                out[k] = walk(v, k);
            }
        }
        return out;
    };

    return walk(value);
}

export { ABSENT as PLACEHOLDER_ABSENT };
