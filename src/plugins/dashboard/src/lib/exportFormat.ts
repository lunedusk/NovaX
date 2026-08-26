import { sanitizeAuditFields, sanitizeAuditMeta } from '#core/audit/redact.js';
import type { AuditRecord } from '#core/audit/types.js';
import type { ErrorOccurrence } from '#core/errors/types.js';

export function serializeAuditForExport(entry: AuditRecord): Record<string, unknown> {
    return {
        id: entry.id,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        target: entry.target,
        outcome: entry.outcome,
        reason: entry.reason,
        meta: sanitizeAuditMeta(entry.meta as Record<string, unknown>),
        createdAt: entry.createdAt,
        surface: entry.surface,
        requestId: entry.requestId,
        targetRef: entry.targetRef,
        before: entry.before ? sanitizeAuditFields(entry.before as Record<string, unknown>) : null,
        after: entry.after ? sanitizeAuditFields(entry.after as Record<string, unknown>) : null,
    };
}

export function serializeErrorForExport(entry: ErrorOccurrence): Record<string, unknown> {
    return {
        id: entry.id,
        code: entry.code,
        category: entry.category,
        severity: entry.severity,
        message: entry.message,
        context: entry.context,
        count: entry.count,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
    };
}

function csvEscape(value: unknown): string {
    if (value === null || value === undefined) return '';
    const s =
        typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '';
    const keys = Array.from(
        rows.reduce((set, row) => {
            for (const k of Object.keys(row)) set.add(k);
            return set;
        }, new Set<string>()),
    );
    const lines = [keys.join(',')];
    for (const row of rows) {
        lines.push(keys.map((k) => csvEscape(row[k])).join(','));
    }
    return lines.join('\n') + '\n';
}
