import type { IndexKind, IndexRecordMeta } from '../types.js';
import type { IndexBackend } from './types.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CrossHost:PostgresIndex');

export interface PostgresIndexDeps {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export async function createPostgresIndex(deps: PostgresIndexDeps): Promise<IndexBackend> {
    await deps.query(`
        CREATE TABLE IF NOT EXISTS crosshost_index (
            kind TEXT NOT NULL,
            id TEXT NOT NULL,
            machine_id TEXT NOT NULL,
            shard_id INTEGER NULL,
            ts BIGINT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            surface TEXT NULL,
            severity TEXT NULL,
            action TEXT NULL,
            PRIMARY KEY (kind, id)
        )
    `);
    await deps.query(
        `CREATE INDEX IF NOT EXISTS crosshost_index_ts_idx ON crosshost_index (kind, ts DESC)`,
    );

    return {
        name: 'postgres',
        async write(meta: IndexRecordMeta): Promise<void> {
            await deps.query(
                `INSERT INTO crosshost_index (kind, id, machine_id, shard_id, ts, summary, surface, severity, action)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 ON CONFLICT (kind, id) DO UPDATE SET
                   machine_id = EXCLUDED.machine_id,
                   shard_id = EXCLUDED.shard_id,
                   ts = EXCLUDED.ts,
                   summary = EXCLUDED.summary,
                   surface = EXCLUDED.surface,
                   severity = EXCLUDED.severity,
                   action = EXCLUDED.action`,
                [
                    meta.kind,
                    meta.id,
                    meta.machineId,
                    meta.shardId,
                    meta.ts,
                    meta.summary,
                    meta.surface ?? null,
                    meta.severity ?? null,
                    meta.action ?? null,
                ],
            );
        },
        async list(opts): Promise<IndexRecordMeta[]> {
            const limit = opts.limit;
            if (opts.kind) {
                const res = await deps.query(
                    opts.beforeTs !== undefined
                        ? `SELECT * FROM crosshost_index WHERE kind = $1 AND ts < $2 ORDER BY ts DESC LIMIT $3`
                        : `SELECT * FROM crosshost_index WHERE kind = $1 ORDER BY ts DESC LIMIT $2`,
                    opts.beforeTs !== undefined
                        ? [opts.kind, opts.beforeTs, limit]
                        : [opts.kind, limit],
                );
                return res.rows.map(rowToMeta);
            }
            const res = await deps.query(
                opts.beforeTs !== undefined
                    ? `SELECT * FROM crosshost_index WHERE ts < $1 ORDER BY ts DESC LIMIT $2`
                    : `SELECT * FROM crosshost_index ORDER BY ts DESC LIMIT $1`,
                opts.beforeTs !== undefined ? [opts.beforeTs, limit] : [limit],
            );
            return res.rows.map(rowToMeta);
        },
        async trim(retentionDays: number): Promise<number> {
            const cutoff = Date.now() - retentionDays * 86_400_000;
            const res = await deps.query(
                `DELETE FROM crosshost_index WHERE ts < $1 RETURNING id`,
                [cutoff],
            );
            log.info('Postgres index trim', { removed: res.rows.length });
            return res.rows.length;
        },
    };
}

function rowToMeta(row: Record<string, unknown>): IndexRecordMeta {
    return {
        kind: row.kind as IndexKind,
        id: String(row.id),
        machineId: String(row.machine_id ?? ''),
        shardId: row.shard_id == null ? null : Number(row.shard_id),
        ts: Number(row.ts ?? 0),
        summary: String(row.summary ?? ''),
        surface: row.surface ? String(row.surface) : undefined,
        severity: row.severity ? String(row.severity) : undefined,
        action: row.action ? String(row.action) : undefined,
    };
}
