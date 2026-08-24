import { redisDB, type RedisClients } from '#core/database/redis.js';
import { TTLCache } from '#core/helpers/cache.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CacheFacade');

const DEFAULT_ALIAS = 'main';
const COOLDOWN_ALIAS_CHAIN = ['cooldown', 'redis'] as const;

export type CacheAlias = string;

export interface CacheFacadeOptions {
    alias?: CacheAlias;
    maxSize?: number;
    defaultTtlMs?: number | null;
}

export interface IncrWithTtlResult {
    count: number;
    ttlMs: number;
    limited: boolean;
}

interface RateLimitRecord {
    count: number;
    resetAt: number;
}

function resolveRedisClient(preferred: readonly string[]): RedisClients['main'] | null {
    for (const alias of preferred) {
        const clients = redisDB.tryGet(alias);
        if (clients?.main) return clients.main;
    }
    return null;
}

export class CacheNamespace {
    readonly alias: string;
    private readonly kvLocal: TTLCache<string, string>;
    private readonly rateLocal: TTLCache<string, RateLimitRecord>;
    private readonly presence: Map<string, true>;
    private readonly preferredAliases: string[];

    constructor(alias: string, preferredAliases: string[], options?: { maxSize?: number; defaultTtlMs?: number | null }) {
        this.alias = alias;
        this.preferredAliases = preferredAliases;
        const maxSize = options?.maxSize ?? 10_000;
        this.kvLocal = new TTLCache<string, string>({
            name: `cache.${alias}.kv`,
            maxSize,
            defaultTTL: options?.defaultTtlMs ?? undefined,
            startCleanupTimer: true,
        });
        this.rateLocal = new TTLCache<string, RateLimitRecord>({
            name: `cache.${alias}.rate`,
            maxSize,
            startCleanupTimer: true,
        });
        this.presence = new Map();
    }

    private redis() {
        return resolveRedisClient(this.preferredAliases);
    }

    public async get(key: string): Promise<string | null> {
        const redis = this.redis();
        if (redis) {
            try {
                const value = await redis.get(key);
                if (value !== null) {
                    this.kvLocal.set(key, value);
                    return value;
                }
                this.kvLocal.delete(key);
                return null;
            } catch (err) {
                log.warn(`Cache get Redis miss-path [${this.alias}:${key}]: ${(err as Error).message}`);
            }
        }
        return this.kvLocal.get(key);
    }

    public async set(key: string, value: string, ttlMs?: number): Promise<void> {
        this.kvLocal.set(key, value, ttlMs);
        const redis = this.redis();
        if (!redis) return;
        try {
            if (ttlMs !== undefined && ttlMs > 0) {
                await redis.set(key, value, 'PX', ttlMs);
            } else {
                await redis.set(key, value);
            }
        } catch (err) {
            log.warn(`Cache set Redis failed [${this.alias}:${key}]: ${(err as Error).message}`);
        }
    }

    public async delete(key: string): Promise<boolean> {
        const localDeleted = this.kvLocal.delete(key);
        this.rateLocal.delete(key);
        const redis = this.redis();
        if (redis) {
            try {
                await redis.del(key);
            } catch (err) {
                log.warn(`Cache delete Redis failed [${this.alias}:${key}]: ${(err as Error).message}`);
            }
        }
        return localDeleted;
    }

    public async deleteByPrefix(prefix: string): Promise<number> {
        let n = 0;
        for (const [key] of this.kvLocal.entries()) {
            if (key.startsWith(prefix)) {
                this.kvLocal.delete(key);
                n++;
            }
        }
        const redis = this.redis();
        if (redis) {
            try {
                let cursor = '0';
                do {
                    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
                    cursor = next;
                    if (keys.length > 0) {
                        await redis.del(...keys);
                        n += keys.length;
                    }
                } while (cursor !== '0');
            } catch (err) {
                log.warn(`Cache deleteByPrefix Redis failed [${this.alias}]: ${(err as Error).message}`);
            }
        }
        return n;
    }

    public async deleteKeysMatching(predicate: (key: string) => boolean): Promise<number> {
        let n = 0;
        for (const [key] of this.kvLocal.entries()) {
            if (predicate(key)) {
                this.kvLocal.delete(key);
                n++;
            }
        }
        const redis = this.redis();
        if (redis) {
            try {
                let cursor = '0';
                do {
                    const [next, keys] = await redis.scan(cursor, 'MATCH', 'permcache_*', 'COUNT', 100);
                    cursor = next;
                    const matched = keys.filter((k) => predicate(k));
                    if (matched.length > 0) {
                        await redis.del(...matched);
                        n += matched.length;
                    }
                } while (cursor !== '0');
            } catch (err) {
                log.warn(`Cache deleteKeysMatching Redis failed [${this.alias}]: ${(err as Error).message}`);
            }
        }
        return n;
    }

    public async has(key: string): Promise<boolean> {
        const redis = this.redis();
        if (redis) {
            try {
                const n = await redis.exists(key);
                return n === 1;
            } catch (err) {
                log.warn(`Cache has Redis failed [${this.alias}:${key}]: ${(err as Error).message}`);
            }
        }
        return this.kvLocal.has(key);
    }

    public async incrWithTtl(
        key: string,
        windowMs: number,
        limit: number,
    ): Promise<IncrWithTtlResult> {
        const redis = this.redis();
        if (redis) {
            try {
                const pipeline = redis.pipeline();
                pipeline.incr(key);
                pipeline.pexpire(key, windowMs, 'NX');
                pipeline.pttl(key);
                const results = await pipeline.exec();
                if (!results) throw new Error('Pipeline returned empty');

                const currentCount = results[0][1] as number;
                const pttl = results[2][1] as number;
                const ttlMs = pttl > 0 ? pttl : windowMs;
                const now = Date.now();

                this.rateLocal.set(
                    key,
                    { count: currentCount, resetAt: now + ttlMs },
                    ttlMs,
                );

                return {
                    count: currentCount,
                    ttlMs,
                    limited: currentCount > limit,
                };
            } catch (err) {
                log.warn(
                    `Cache incrWithTtl Redis failed [${this.alias}:${key}]: ${(err as Error).message}. Using local.`,
                );
            }
        }
        return this.incrWithTtlLocal(key, windowMs, limit);
    }

    public async decr(key: string): Promise<void> {
        const redis = this.redis();
        if (redis) {
            try {
                const current = await redis.get(key);
                if (current && parseInt(current, 10) > 0) {
                    await redis.decr(key);
                }
                const local = this.rateLocal.get(key);
                if (local && local.count > 0) {
                    local.count -= 1;
                    this.rateLocal.set(key, local, Math.max(1, local.resetAt - Date.now()));
                }
                return;
            } catch (err) {
                log.warn(`Cache decr Redis failed [${this.alias}:${key}]: ${(err as Error).message}`);
            }
        }

        const record = this.rateLocal.get(key);
        if (!record || record.count <= 0) return;
        record.count -= 1;
        this.rateLocal.set(key, record, Math.max(1, record.resetAt - Date.now()));
    }

    private incrWithTtlLocal(key: string, windowMs: number, limit: number): IncrWithTtlResult {
        const now = Date.now();
        let record = this.rateLocal.get(key);

        if (!record) {
            record = { count: 1, resetAt: now + windowMs };
            this.rateLocal.set(key, record, windowMs);
            return {
                count: 1,
                ttlMs: windowMs,
                limited: limit < 1,
            };
        }

        const remainingTime = record.resetAt - now;
        if (remainingTime <= 0) {
            record = { count: 1, resetAt: now + windowMs };
            this.rateLocal.set(key, record, windowMs);
            return { count: 1, ttlMs: windowMs, limited: false };
        }

        record.count += 1;
        this.rateLocal.set(key, record, remainingTime);
        return {
            count: record.count,
            ttlMs: remainingTime,
            limited: record.count > limit,
        };
    }

    public hasPresence(key: string): boolean {
        return this.presence.has(key);
    }

    public setPresence(key: string): void {
        this.presence.set(key, true);
        void this.dualWritePresence(key, true);
    }

    public deletePresence(key: string): void {
        this.presence.delete(key);
        void this.dualWritePresence(key, false);
    }

    public clearPresence(): void {
        this.presence.clear();
    }

    public loadPresence(keys: Iterable<string>): void {
        for (const key of keys) {
            this.presence.set(key, true);
        }
    }

    private async dualWritePresence(key: string, present: boolean): Promise<void> {
        const redis = this.redis();
        if (!redis) return;
        const redisKey = `presence:${this.alias}:${key}`;
        try {
            if (present) {
                await redis.set(redisKey, '1');
            } else {
                await redis.del(redisKey);
            }
        } catch (err) {
            log.warn(`Presence dual-write failed [${this.alias}:${key}]: ${(err as Error).message}`);
        }
    }
}

export class CacheFacade {
    private readonly namespaces = new Map<string, CacheNamespace>();

    public namespace(alias: string = DEFAULT_ALIAS, options?: CacheFacadeOptions): CacheNamespace {
        const key = alias || DEFAULT_ALIAS;
        let ns = this.namespaces.get(key);
        if (!ns) {
            const preferred =
                key === 'cooldown'
                    ? [...COOLDOWN_ALIAS_CHAIN]
                    : key === 'guildGate'
                      ? ['guildGate', 'main', 'redis']
                      : [key, DEFAULT_ALIAS];
            ns = new CacheNamespace(key, preferred, {
                maxSize: options?.maxSize,
                defaultTtlMs: options?.defaultTtlMs ?? null,
            });
            this.namespaces.set(key, ns);
        }
        return ns;
    }

    public cooldown(): CacheNamespace {
        return this.namespace('cooldown');
    }

    public guildGate(): CacheNamespace {
        return this.namespace('guildGate');
    }

    public main(): CacheNamespace {
        return this.namespace(DEFAULT_ALIAS);
    }
}

export const cacheFacade = new CacheFacade();
