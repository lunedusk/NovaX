import { getLogger } from '#core/utils/logger.js';
import type { IndexRecordMeta } from '../types.js';
import type { IndexBackend } from './types.js';

const log = getLogger('CrossHost:IndexWriter');

let backend: IndexBackend | null = null;
let machineId: string | null = null;
let getShardId: (() => number | null) | null = null;

export function configureIndexWriter(opts: {
    backend: IndexBackend | null;
    machineId: string;
    getShardId: () => number | null;
}): void {
    backend = opts.backend;
    machineId = opts.machineId;
    getShardId = opts.getShardId;
}

export function isCrossHostWorkerIndexActive(): boolean {
    return backend !== null && machineId !== null;
}

export async function publishIndexMetadata(
    meta: Omit<IndexRecordMeta, 'machineId' | 'shardId'> & {
        machineId?: string;
        shardId?: number | null;
    },
): Promise<void> {
    if (!backend || !machineId) return;
    const full: IndexRecordMeta = {
        kind: meta.kind,
        id: meta.id,
        machineId: meta.machineId ?? machineId,
        shardId: meta.shardId !== undefined ? meta.shardId : getShardId ? getShardId() : null,
        ts: meta.ts,
        summary: meta.summary,
        surface: meta.surface,
        severity: meta.severity,
        action: meta.action,
    };
    try {
        await backend.write(full);
    } catch (err) {
        log.warn('Index metadata publish failed (best-effort)', {
            kind: full.kind,
            id: full.id,
            err,
        });
    }
}
