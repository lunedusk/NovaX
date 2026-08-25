import { randomBytes } from 'node:crypto';
import { resolveBackend, type BackendChoice } from '#core/database/backendSelector.js';
import { openSqlAdapter, type SqlAdapter } from '#core/database/sqlAdapter.js';
import { sanitizeAuditFields, sanitizeAuditMeta } from './redact.js';
import type {
    AuditMeta,
    AuditRecord,
    AuditRecordInput,
    AuditSurface,
    AuditTargetRef,
} from './types.js';

function newId(): string {
    return randomBytes(16).toString('hex');
}

function parseTargetRef(raw: unknown): AuditTargetRef | null {
    if (raw == null) return null;
    let obj: unknown = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const r = obj as Record<string, unknown>;
    const type = String(r.type ?? '');
    const id = String(r.id ?? '');
    if (!id) return null;
    const allowed: AuditTargetRef['type'][] = [
        'user',
        'guild',
        'plugin',
        'role',
        'token_device',
        'config',
        'other',
    ];
    const t = (allowed.includes(type as AuditTargetRef['type'])
        ? type
        : 'other') as AuditTargetRef['type'];
    const label = typeof r.label === 'string' ? r.label.slice(0, 256) : undefined;
    return label !== undefined ? { type: t, id, label } : { type: t, id };
}

function parseSurface(raw: unknown): AuditSurface | null {
    if (raw == null) return null;
    const s = String(raw);
    if (s === 'discord' || s === 'http' || s === 'cli' || s === 'system' || s === 'dashboard') {
        return s;
    }
    return null;
}

function parseFieldMap(raw: unknown): AuditMeta | null {
    if (raw == null) return null;
    if (typeof raw === 'string') {
        if (raw === '' || raw === 'null') return null;
        try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const cleaned = sanitizeAuditFields(parsed as Record<string, unknown>);
                return Object.keys(cleaned).length ? cleaned : null;
            }
        } catch {
            return null;
        }
        return null;
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
        const cleaned = sanitizeAuditFields(raw as Record<string, unknown>);
        return Object.keys(cleaned).length ? cleaned : null;
    }
    return null;
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
    const before = input.before ? sanitizeAuditFields(input.before) : null;
    const after = input.after ? sanitizeAuditFields(input.after) : null;
    const targetRef = input.targetRef
        ? parseTargetRef({
              type: input.targetRef.type,
              id: String(input.targetRef.id).slice(0, 256),
              label:
                  typeof input.targetRef.label === 'string'
                      ? input.targetRef.label.slice(0, 256)
                      : undefined,
          })
        : null;
    const surface = input.surface ? parseSurface(input.surface) : null;
    const requestId =
        typeof input.requestId === 'string' && input.requestId.length > 0
            ? input.requestId.slice(0, 128)
            : null;

    const record: AuditRecord = {
        id: newId(),
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        target: input.target,
        outcome: input.outcome,
        reason: input.reason ?? null,
        meta: sanitizeAuditMeta(input.meta),
        createdAt: Math.floor(Date.now() / 1000),
        surface,
        requestId,
        targetRef,
        before: before && Object.keys(before).length ? before : null,
        after: after && Object.keys(after).length ? after : null,
    };

    const metaJson = JSON.stringify(record.meta);
    const targetRefJson = record.targetRef ? JSON.stringify(record.targetRef) : null;
    const beforeJson = record.before ? JSON.stringify(record.before) : null;
    const afterJson = record.after ? JSON.stringify(record.after) : null;

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
            surface: record.surface,
            requestId: record.requestId,
            targetRef: record.targetRef,
            before: record.before,
            after: record.after,
        });
        return record;
    }

    await adapter.run(
        `INSERT INTO audit_entries
            (id, actor_type, actor_id, action, target, outcome, reason, meta, created_at,
             surface, request_id, target_ref, before_json, after_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            record.surface,
            record.requestId,
            targetRefJson,
            beforeJson,
            afterJson,
        ],
    );
    return record;
}

export interface AuditListFilter {
    actorId?: string;
    actorType?: string;
    action?: string;
    outcome?: string;
    surface?: string;
    requestId?: string;
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

function rowToRecord(row: Record<string, unknown>): AuditRecord {
    let meta: AuditMeta = {};
    const rawMeta = row.meta;
    if (typeof rawMeta === 'string') {
        try {
            const parsed: unknown = JSON.parse(rawMeta);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                meta = sanitizeAuditMeta(parsed as Record<string, unknown>);
            }
        } catch {
            meta = {};
        }
    } else if (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
        meta = sanitizeAuditMeta(rawMeta as Record<string, unknown>);
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
        surface: parseSurface(row.surface),
        requestId:
            row.requestId != null || row.request_id != null
                ? String(row.requestId ?? row.request_id)
                : null,
        targetRef: parseTargetRef(row.targetRef ?? row.target_ref),
        before: parseFieldMap(row.before ?? row.before_json),
        after: parseFieldMap(row.after ?? row.after_json),
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
        if (filter.surface) q.surface = filter.surface;
        if (filter.requestId) q.requestId = filter.requestId;
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
    if (filter.surface) {
        clauses.push('surface = ?');
        params.push(filter.surface);
    }
    if (filter.requestId) {
        clauses.push('request_id = ?');
        params.push(filter.requestId);
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
        `SELECT id, actor_type, actor_id, action, target, outcome, reason, meta, created_at,
                surface, request_id, target_ref, before_json, after_json
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
        `SELECT id, actor_type, actor_id, action, target, outcome, reason, meta, created_at,
                surface, request_id, target_ref, before_json, after_json
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
