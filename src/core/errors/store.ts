import { randomBytes } from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { resolveBackend, type BackendChoice } from '#core/database/backendSelector.js';
import { openSqlAdapter, type SqlAdapter } from '#core/database/sqlAdapter.js';
import type {
    ErrorContext,
    ErrorContextValue,
    ErrorOccurrence,
    ErrorOccurrenceInput,
    ErrorSeverity,
} from './types.js';

const log = getLogger('ErrorStore');

const ALLOWED_CONTEXT_KEYS = new Set([
    'count',
    'name',
    'guildId',
    'userId',
    'pluginId',
    'roleId',
    'deviceId',
    'path',
    'method',
    'code',
    'status',
    'route',
    'bit',
    'target',
    'actorId',
    'actorType',
]);

function coalesceWindowSec(): number {
    const raw = secrets.getOptional('ErrorCoalesceWindowSec', '60');
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return 60;
    return Math.min(Math.floor(n), 3600);
}

function sanitizeContext(ctx: Record<string, unknown> | undefined): ErrorContext {
    const out: ErrorContext = {};
    if (!ctx) return out;
    for (const [key, value] of Object.entries(ctx)) {
        if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
        if (value === null) {
            out[key] = null;
            continue;
        }
        const t = typeof value;
        if (t === 'number' || t === 'boolean') {
            out[key] = value as ErrorContextValue;
            continue;
        }
        if (t === 'string') {
            const s = value as string;
            out[key] = s.length > 256 ? s.slice(0, 256) : s;
        }
    }
    return out;
}

function newId(): string {
    return randomBytes(16).toString('hex');
}

export function resolveErrorBackend(): BackendChoice {
    return resolveBackend({
        configSection: 'errors',
        envEngineKey: 'ErrorsEngine',
        envAliasKey: 'ErrorsDbAlias',
        defaultAlias: 'main',
    });
}

let cachedAdapter: SqlAdapter | null = null;
let cachedKey = '';

function getAdapter(): SqlAdapter {
    const choice = resolveErrorBackend();
    const key = `${choice.engine}:${choice.alias}`;
    if (cachedAdapter && cachedKey === key) return cachedAdapter;
    cachedAdapter = openSqlAdapter(choice);
    cachedKey = key;
    return cachedAdapter;
}

function rowToOccurrence(row: Record<string, unknown>): ErrorOccurrence {
    let context: ErrorContext = {};
    const raw = row.context;
    if (typeof raw === 'string') {
        try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                context = sanitizeContext(parsed as Record<string, unknown>);
            }
        } catch {
            context = {};
        }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        context = sanitizeContext(raw as Record<string, unknown>);
    }
    const severityRaw = String(row.severity ?? 'error');
    const severity: ErrorSeverity =
        severityRaw === 'debug' ||
        severityRaw === 'info' ||
        severityRaw === 'warn' ||
        severityRaw === 'error' ||
        severityRaw === 'fatal'
            ? severityRaw
            : 'error';
    return {
        id: String(row.id ?? ''),
        code: String(row.code ?? ''),
        category: String(row.category ?? 'unknown'),
        severity,
        message: String(row.message ?? ''),
        context,
        count: Number(row.count ?? 1),
        firstSeen: Number(row.firstSeen ?? row.first_seen ?? 0),
        lastSeen: Number(row.lastSeen ?? row.last_seen ?? 0),
    };
}

export async function upsertErrorOccurrence(input: ErrorOccurrenceInput): Promise<ErrorOccurrence | null> {
    try {
        const adapter = getAdapter();
        const now = Math.floor(Date.now() / 1000);
        const windowSec = coalesceWindowSec();
        const windowStart = now - windowSec;
        const context = sanitizeContext(input.context);
        const contextJson = JSON.stringify(context);
        const code = input.code.slice(0, 128);
        const category = String(input.category).slice(0, 64);
        const severity = input.severity;
        const message = input.message.slice(0, 512);

        if (adapter.engine === 'mongo') {
            const col = adapter.mongoCollection('error_occurrences');
            const existing = await col.find({
                code,
                lastSeen: { $gte: windowStart },
            });
            existing.sort((a, b) => Number(b.lastSeen ?? 0) - Number(a.lastSeen ?? 0));
            const hit = existing[0];
            if (hit) {
                const id = String(hit.id ?? '');
                const count = Number(hit.count ?? 1) + 1;
                await col.updateOne(
                    { id },
                    {
                        $set: {
                            count,
                            lastSeen: now,
                            message,
                            context,
                            severity,
                            category,
                        },
                    },
                );
                return {
                    id,
                    code,
                    category,
                    severity,
                    message,
                    context,
                    count,
                    firstSeen: Number(hit.firstSeen ?? now),
                    lastSeen: now,
                };
            }
            const id = newId();
            const record: ErrorOccurrence = {
                id,
                code,
                category,
                severity,
                message,
                context,
                count: 1,
                firstSeen: now,
                lastSeen: now,
            };
            await col.insertOne({
                id: record.id,
                code: record.code,
                category: record.category,
                severity: record.severity,
                message: record.message,
                context: record.context,
                count: record.count,
                firstSeen: record.firstSeen,
                lastSeen: record.lastSeen,
            });
            return record;
        }

        const existing = await adapter.get(
            `SELECT id, code, category, severity, message, context, count, first_seen, last_seen
             FROM error_occurrences
             WHERE code = ? AND last_seen >= ?
             ORDER BY last_seen DESC
             LIMIT 1`,
            [code, windowStart],
        );

        if (existing) {
            const id = String(existing.id ?? '');
            const count = Number(existing.count ?? 1) + 1;
            await adapter.run(
                `UPDATE error_occurrences
                 SET count = ?, last_seen = ?, message = ?, context = ?, severity = ?, category = ?
                 WHERE id = ?`,
                [count, now, message, contextJson, severity, category, id],
            );
            return {
                id,
                code,
                category,
                severity,
                message,
                context,
                count,
                firstSeen: Number(existing.first_seen ?? now),
                lastSeen: now,
            };
        }

        const id = newId();
        await adapter.run(
            `INSERT INTO error_occurrences
                (id, code, category, severity, message, context, count, first_seen, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, code, category, severity, message, contextJson, 1, now, now],
        );
        return {
            id,
            code,
            category,
            severity,
            message,
            context,
            count: 1,
            firstSeen: now,
            lastSeen: now,
        };
    } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        log.error(`ErrorStore write failed (terminal, not re-entrant): ${e.message}`);
        return null;
    }
}

export interface ErrorListFilter {
    code?: string;
    category?: string;
    severity?: string;
    from?: number;
    to?: number;
    limit?: number;
}

function clampLimit(limit: number | undefined): number {
    const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : 50;
    if (n < 1) return 1;
    if (n > 100_000) return 100_000;
    return n;
}

export async function listErrorOccurrences(filter: ErrorListFilter = {}): Promise<ErrorOccurrence[]> {
    const adapter = getAdapter();
    const limit = clampLimit(filter.limit);

    if (adapter.engine === 'mongo') {
        const q: Record<string, unknown> = {};
        if (filter.code) q.code = filter.code;
        if (filter.category) q.category = filter.category;
        if (filter.severity) q.severity = filter.severity;
        if (filter.from != null || filter.to != null) {
            const range: Record<string, number> = {};
            if (filter.from != null) range.$gte = filter.from;
            if (filter.to != null) range.$lte = filter.to;
            q.lastSeen = range;
        }
        const docs = await adapter.mongoCollection('error_occurrences').find(q);
        docs.sort((a, b) => Number(b.lastSeen ?? 0) - Number(a.lastSeen ?? 0));
        return docs.slice(0, limit).map((d) => rowToOccurrence(d as Record<string, unknown>));
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.code) {
        clauses.push('code = ?');
        params.push(filter.code);
    }
    if (filter.category) {
        clauses.push('category = ?');
        params.push(filter.category);
    }
    if (filter.severity) {
        clauses.push('severity = ?');
        params.push(filter.severity);
    }
    if (filter.from != null) {
        clauses.push('last_seen >= ?');
        params.push(filter.from);
    }
    if (filter.to != null) {
        clauses.push('last_seen <= ?');
        params.push(filter.to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const rows = await adapter.all(
        `SELECT id, code, category, severity, message, context, count, first_seen, last_seen
         FROM error_occurrences
         ${where}
         ORDER BY last_seen DESC
         LIMIT ?`,
        params,
    );
    return rows.map((r) => rowToOccurrence(r as Record<string, unknown>));
}

export async function getErrorOccurrenceById(id: string): Promise<ErrorOccurrence | null> {
    const adapter = getAdapter();
    if (adapter.engine === 'mongo') {
        const doc = await adapter.mongoCollection('error_occurrences').findOne({ id });
        if (!doc) return null;
        return rowToOccurrence(doc as Record<string, unknown>);
    }
    const row = await adapter.get(
        `SELECT id, code, category, severity, message, context, count, first_seen, last_seen
         FROM error_occurrences WHERE id = ? LIMIT 1`,
        [id],
    );
    if (!row) return null;
    return rowToOccurrence(row as Record<string, unknown>);
}

export function resetErrorAdapterCache(): void {
    cachedAdapter = null;
    cachedKey = '';
}
