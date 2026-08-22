import { randomBytes } from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';
import { resolveBackend, type BackendChoice } from '#core/database/backendSelector.js';
import { openSqlAdapter, type SqlAdapter } from '#core/database/sqlAdapter.js';
import type { AuditMeta, AuditMetaValue, AuditRecord, AuditRecordInput } from './types.js';

const log = getLogger('AuditStore');

const ALLOWED_META_KEYS = new Set([
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
]);

function sanitizeMeta(meta: Record<string, unknown> | undefined): AuditMeta {
    const out: AuditMeta = {};
    if (!meta) return out;
    for (const [key, value] of Object.entries(meta)) {
        if (!ALLOWED_META_KEYS.has(key)) continue;
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
            out[key] = s.length > 256 ? s.slice(0, 256) : s;
        }
    }
    return out;
}

function newId(): string {
    return randomBytes(16).toString('hex');
}

export function resolveAuditBackend(): BackendChoice {
    return resolveBackend({
        configSection: 'audit',
        envEngineKey: 'AuditEngine',
        envAliasKey: 'AuditDbAlias',
        defaultAlias: 'main',
    });
}

let cachedAdapter: SqlAdapter | null = null;
let cachedKey = '';

function getAdapter(): SqlAdapter {
    const choice = resolveAuditBackend();
    const key = `${choice.engine}:${choice.alias}`;
    if (cachedAdapter && cachedKey === key) return cachedAdapter;
    cachedAdapter = openSqlAdapter(choice);
    cachedKey = key;
    return cachedAdapter;
}

export async function insertAuditRecord(input: AuditRecordInput): Promise<AuditRecord> {
    const adapter = getAdapter();
    const record: AuditRecord = {
        id: newId(),
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        target: input.target,
        outcome: input.outcome,
        reason: input.reason ?? null,
        meta: sanitizeMeta(input.meta),
        createdAt: Math.floor(Date.now() / 1000),
    };

    const metaJson = JSON.stringify(record.meta);

    if (adapter.engine === 'mongo') {
        await adapter.mongoCollection('audit_entries').insertOne({
            id: record.id,
            actorType: record.actorType,
            actorId: record.actorId,
            action: record.action,
            target: record.target,
            outcome: record.outcome,
            reason: record.reason,
            meta: record.meta,
            createdAt: record.createdAt,
        });
        return record;
    }

    await adapter.run(
        `INSERT INTO audit_entries
            (id, actor_type, actor_id, action, target, outcome, reason, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            record.id,
            record.actorType,
            record.actorId,
            record.action,
            record.target,
            record.outcome,
            record.reason,
            metaJson,
            record.createdAt,
        ],
    );
    return record;
}


export interface AuditListFilter {
    actorId?: string;
    actorType?: string;
    action?: string;
    outcome?: string;
    from?: number;
    to?: number;
    limit?: number;
}

function clampLimit(limit: number | undefined): number {
    const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : 50;
    if (n < 1) return 1;
    if (n > 200) return 200;
    return n;
}

function rowToRecord(row: Record<string, unknown>): AuditRecord {
    let meta: AuditMeta = {};
    const rawMeta = row.meta;
    if (typeof rawMeta === 'string') {
        try {
            const parsed: unknown = JSON.parse(rawMeta);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                meta = sanitizeMeta(parsed as Record<string, unknown>);
            }
        } catch {
            meta = {};
        }
    } else if (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
        meta = sanitizeMeta(rawMeta as Record<string, unknown>);
    }
    const actorType = String(row.actorType ?? row.actor_type ?? 'system');
    const outcome = String(row.outcome ?? 'success');
    return {
        id: String(row.id ?? ''),
        actorType: (actorType === 'user' || actorType === 'api_key' || actorType === 'system'
            ? actorType
            : 'system') as AuditRecord['actorType'],
        actorId: String(row.actorId ?? row.actor_id ?? ''),
        action: String(row.action ?? ''),
        target: String(row.target ?? ''),
        outcome: (outcome === 'fail' ? 'fail' : 'success') as AuditRecord['outcome'],
        reason: row.reason == null ? null : String(row.reason),
        meta,
        createdAt: Number(row.createdAt ?? row.created_at ?? 0),
    };
}

export async function listAuditRecords(filter: AuditListFilter = {}): Promise<AuditRecord[]> {
    const adapter = getAdapter();
    const limit = clampLimit(filter.limit);

    if (adapter.engine === 'mongo') {
        const q: Record<string, unknown> = {};
        if (filter.actorId) q.actorId = filter.actorId;
        if (filter.actorType) q.actorType = filter.actorType;
        if (filter.action) q.action = filter.action;
        if (filter.outcome) q.outcome = filter.outcome;
        if (filter.from != null || filter.to != null) {
            const range: Record<string, number> = {};
            if (filter.from != null) range.$gte = filter.from;
            if (filter.to != null) range.$lte = filter.to;
            q.createdAt = range;
        }
        const docs = await adapter.mongoCollection('audit_entries').find(q);
        docs.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
        return docs.slice(0, limit).map((d) => rowToRecord(d as Record<string, unknown>));
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.actorId) {
        clauses.push('actor_id = ?');
        params.push(filter.actorId);
    }
    if (filter.actorType) {
        clauses.push('actor_type = ?');
        params.push(filter.actorType);
    }
    if (filter.action) {
        clauses.push('action = ?');
        params.push(filter.action);
    }
    if (filter.outcome) {
        clauses.push('outcome = ?');
        params.push(filter.outcome);
    }
    if (filter.from != null) {
        clauses.push('created_at >= ?');
        params.push(filter.from);
    }
    if (filter.to != null) {
        clauses.push('created_at <= ?');
        params.push(filter.to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const rows = await adapter.all(
        `SELECT id, actor_type, actor_id, action, target, outcome, reason, meta, created_at
         FROM audit_entries
         ${where}
         ORDER BY created_at DESC
         LIMIT ?`,
        params,
    );
    return rows.map((r) => rowToRecord(r as Record<string, unknown>));
}

export async function getAuditRecordById(id: string): Promise<AuditRecord | null> {
    const adapter = getAdapter();
    if (adapter.engine === 'mongo') {
        const doc = await adapter.mongoCollection('audit_entries').findOne({ id });
        if (!doc) return null;
        return rowToRecord(doc as Record<string, unknown>);
    }
    const row = await adapter.get(
        `SELECT id, actor_type, actor_id, action, target, outcome, reason, meta, created_at
         FROM audit_entries WHERE id = ? LIMIT 1`,
        [id],
    );
    if (!row) return null;
    return rowToRecord(row as Record<string, unknown>);
}

export function resetAuditAdapterCache(): void {
    cachedAdapter = null;
    cachedKey = '';
}
