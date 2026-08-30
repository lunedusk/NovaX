import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { eventBus } from '#core/manager/events/EventBus.js';
import { insertAuditRecord, listAuditRecords, getAuditRecordById, type AuditListFilter } from './store.js';
import type { AuditRecord, AuditRecordInput } from './types.js';

const log = getLogger('Audit');

export type {
    AuditRecord,
    AuditRecordInput,
    AuditActionCode,
    AuditActorType,
    AuditOutcome,
    AuditMeta,
    AuditSurface,
    AuditTargetRef,
    AuditTargetType,
} from './types.js';
export type { AuditListFilter } from './store.js';
export { sanitizeAuditFields, sanitizeAuditMeta } from './redact.js';

function auditFailClosed(): boolean {
    return secrets.getBoolean('AuditFailClosed', false);
}

export async function record(input: AuditRecordInput): Promise<AuditRecord | null> {
    try {
        const entry = await insertAuditRecord(input);
        void eventBus
            .emit('audit.recorded', entry)
            .catch((err: unknown) => {
                const e = err instanceof Error ? err : new Error(String(err));
                log.error(`audit.recorded emit failed: ${e.message}`);
            });
        void import('#core/crosshost/indexStore/writer.js')
            .then(({ isCrossHostWorkerIndexActive, publishIndexMetadata }) => {
                if (!isCrossHostWorkerIndexActive()) return;
                return publishIndexMetadata({
                    kind: 'audit',
                    id: entry.id,
                    ts: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
                    summary: `${entry.action} ${entry.outcome}`.slice(0, 256),
                    surface: entry.surface ?? undefined,
                    action: entry.action,
                });
            })
            .catch(() => {});
        return entry;
    } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        log.error(
            `Audit write failed action=${input.action} actor=${input.actorType}:${input.actorId} target=${input.target} outcome=${input.outcome}: ${e.message}`,
        );
        if (auditFailClosed()) {
            throw e;
        }
        return null;
    }
}

export async function list(filter?: AuditListFilter): Promise<AuditRecord[]> {
    return listAuditRecords(filter ?? {});
}

export async function getById(id: string): Promise<AuditRecord | null> {
    return getAuditRecordById(id);
}

export const audit = Object.freeze({
    record,
    list,
    getById,
});
