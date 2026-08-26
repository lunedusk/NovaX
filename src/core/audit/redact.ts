import type { AuditMeta, AuditMetaValue } from './types.js';

const ALLOWED_FIELD_KEYS = new Set([
    'count',
    'name',
    'guildId',
    'userId',
    'pluginId',
    'roleId',
    'deviceId',
    'cacheName',
    'file',
    'namespace',
    'path',
    'method',
    'code',
    'bit',
    'bitsCount',
    'target',
    'version',
    'jti',
    'id',
    'label',
    'type',
    'status',
    'enabled',
    'color',
    'locale',
    'scope',
    'outcome',
    'action',
    'priority',
    'order',
    'surface',
    'requestId',
]);

const SECRET_KEY_BACKSTOP = /token|secret|password|passwd|authorization|cookie|credential|apikey|api_key|private|bearer|session/i;

const MAX_STRING = 256;

export function sanitizeAuditFields(input: Record<string, unknown> | undefined | null): AuditMeta {
    const out: AuditMeta = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    for (const [key, value] of Object.entries(input)) {
        if (!ALLOWED_FIELD_KEYS.has(key)) continue;
        if (SECRET_KEY_BACKSTOP.test(key)) continue;
        if (value === null) {
            out[key] = null;
            continue;
        }
        const t = typeof value;
        if (t === 'number' || t === 'boolean') {
            out[key] = value as AuditMetaValue;
            continue;
        }
        if (t === 'string') {
            const s = value as string;
            out[key] = s.length > MAX_STRING ? s.slice(0, MAX_STRING) : s;
        }
    }
    return out;
}

export function sanitizeAuditMeta(meta: Record<string, unknown> | undefined): AuditMeta {
    return sanitizeAuditFields(meta);
}
