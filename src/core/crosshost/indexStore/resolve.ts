import type { Redis } from 'ioredis';
import { secrets } from '#core/helpers/secretManager.js';
import { getLogger } from '#core/utils/logger.js';
import type { CrossHostEnv } from '../types.js';
import { createRedisIndex } from './redisIndex.js';
import { createPostgresIndex } from './postgresIndex.js';
import type { IndexResolveResult } from './types.js';

const log = getLogger('CrossHost:IndexResolve');

function parseDatabaseMap(): Record<string, { uri: string; engine?: string }> {
    const raw = secrets.getOptional('Database') ?? '{}';
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, { uri: string; engine?: string }> = {};
    for (const [alias, entry] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const rec = entry as Record<string, unknown>;
        if (typeof rec.uri !== 'string' || !rec.uri) continue;
        out[alias] = {
            uri: rec.uri,
            engine: typeof rec.engine === 'string' ? rec.engine.toLowerCase() : undefined,
        };
    }
    return out;
}

function isPostgres(entry: { uri: string; engine?: string }): boolean {
    if (entry.engine === 'postgres' || entry.engine === 'postgresql') return true;
    const u = entry.uri.toLowerCase();
    return u.startsWith('postgres://') || u.startsWith('postgresql://');
}

export async function resolveIndexBackend(
    env: CrossHostEnv,
    redis: Redis,
    channelPrefix: string,
): Promise<IndexResolveResult> {
    if (!env.indexEnabled) {
        return { enabled: false, reason: 'CROSS_HOST_INDEX_ENABLED=false' };
    }

    if (env.indexBackend === 'redis') {
        log.info('Index backend: redis');
        return { enabled: true, backend: createRedisIndex(redis, channelPrefix) };
    }

    const map = parseDatabaseMap();
    const preferred = map['crosshost_index'];
    const main = map['main'];
    const target =
        preferred && isPostgres(preferred)
            ? preferred
            : main && isPostgres(main)
              ? main
              : null;

    if (!target) {
        log.warn(
            'CROSS_HOST_INDEX_ENABLED with backend=postgres but neither Database.crosshost_index nor postgres Database.main is available; disabling index for this process',
        );
        return {
            enabled: false,
            reason: 'postgres index target missing (crosshost_index or main)',
        };
    }

    try {
        const pg = await import('pg');
        const pool = new pg.default.Pool({ connectionString: target.uri, max: 4 });
        const backend = await createPostgresIndex({
            async query(sql, params = []) {
                const res = await pool.query(sql, params);
                return { rows: res.rows as Record<string, unknown>[] };
            },
        });
        log.info('Index backend: postgres', {
            alias: preferred && isPostgres(preferred) ? 'crosshost_index' : 'main',
        });
        return { enabled: true, backend };
    } catch (err) {
        log.warn('Failed to initialize postgres index; disabling', err);
        return { enabled: false, reason: 'postgres index init failed' };
    }
}
