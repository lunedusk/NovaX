import type { Redis } from 'ioredis';
import type { IndexKind, IndexRecordMeta } from '../types.js';
import type { IndexBackend } from './types.js';

function keyZ(prefix: string, kind: IndexKind): string {
    return `${prefix}:index:${kind}:z`;
}

function keyH(prefix: string, kind: IndexKind, id: string): string {
    return `${prefix}:index:${kind}:h:${id}`;
}

export function createRedisIndex(redis: Redis, prefix: string): IndexBackend {
    return {
        name: 'redis',
        async write(meta: IndexRecordMeta): Promise<void> {
            const pipe = redis.pipeline();
            pipe.zadd(keyZ(prefix, meta.kind), meta.ts, meta.id);
            pipe.hset(keyH(prefix, meta.kind, meta.id), {
                kind: meta.kind,
                id: meta.id,
                machineId: meta.machineId,
                shardId: meta.shardId === null ? '' : String(meta.shardId),
                ts: String(meta.ts),
                summary: meta.summary,
                surface: meta.surface ?? '',
                severity: meta.severity ?? '',
                action: meta.action ?? '',
            });
            await pipe.exec();
        },
        async list(opts): Promise<IndexRecordMeta[]> {
            const kinds: IndexKind[] = opts.kind ? [opts.kind] : ['audit', 'error'];
            const out: IndexRecordMeta[] = [];
            for (const kind of kinds) {
                const max = opts.beforeTs !== undefined ? opts.beforeTs - 1 : '+inf';
                const ids = await redis.zrevrangebyscore(
                    keyZ(prefix, kind),
                    max,
                    '-inf',
                    'LIMIT',
                    0,
                    opts.limit,
                );
                for (const id of ids) {
                    const h = await redis.hgetall(keyH(prefix, kind, id));
                    if (!h || !h.id) continue;
                    out.push({
                        kind,
                        id: h.id,
                        machineId: h.machineId ?? '',
                        shardId: h.shardId ? Number(h.shardId) : null,
                        ts: Number(h.ts ?? 0),
                        summary: h.summary ?? '',
                        surface: h.surface || undefined,
                        severity: h.severity || undefined,
                        action: h.action || undefined,
                    });
                }
            }
            out.sort((a, b) => b.ts - a.ts);
            return out.slice(0, opts.limit);
        },
        async trim(retentionDays: number): Promise<number> {
            const cutoff = Date.now() - retentionDays * 86_400_000;
            let removed = 0;
            for (const kind of ['audit', 'error'] as IndexKind[]) {
                const old = await redis.zrangebyscore(keyZ(prefix, kind), '-inf', cutoff);
                if (old.length === 0) continue;
                const pipe = redis.pipeline();
                for (const id of old) {
                    pipe.zrem(keyZ(prefix, kind), id);
                    pipe.del(keyH(prefix, kind, id));
                }
                await pipe.exec();
                removed += old.length;
            }
            return removed;
        },
    };
}
