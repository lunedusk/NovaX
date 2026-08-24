import { getLogger } from '#core/utils/logger.js';

const log = getLogger('TTLCache');

export interface CacheStats {
    size: number;
    hits: number;
    misses: number;
    expired: number;
    evicted: number;
}

export interface TTLCacheOptions {
    maxSize?: number;
    defaultTTL?: number;
    cleanupInterval?: number;
    startCleanupTimer?: boolean;
    name?: string;
}

interface CacheItem<V> {
    value: V;
    expiresAt: number | null;
}

type AnyCache = TTLCache<unknown, unknown>;

export interface CacheRegistryEntry {
    name: string;
    size: number;
    cache: AnyCache;
}

const registry = new Map<string, AnyCache>();

export function listRegisteredCaches(): CacheRegistryEntry[] {
    const out: CacheRegistryEntry[] = [];
    for (const [name, cache] of registry) {
        out.push({ name, size: cache.stats.size, cache });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

export function getRegisteredCache(name: string): AnyCache | undefined {
    return registry.get(name);
}

export function registerCache(name: string, cache: AnyCache): void {
    const key = name.trim();
    if (!key) return;
    if (registry.has(key) && registry.get(key) !== cache) {
        log.warn(`TTLCache registry: replacing registration for [${key}]`);
    }
    registry.set(key, cache);
}

export function unregisterCache(name: string, cache?: AnyCache): void {
    const existing = registry.get(name);
    if (!existing) return;
    if (cache && existing !== cache) return;
    registry.delete(name);
}

export class TTLCache<K, V> {
    private readonly maxSize: number;
    private readonly defaultTTL: number | null;
    private readonly cleanupInterval: number;
    public readonly name: string | null;

    private readonly data = new Map<K, CacheItem<V>>();

    private hits = 0;
    private misses = 0;
    private expiredCount = 0;
    private evictedCount = 0;

    private cleanupTimer: NodeJS.Timeout | null = null;

    constructor(options: TTLCacheOptions = {}) {
        this.maxSize = options.maxSize ?? 1024;
        this.defaultTTL = options.defaultTTL ?? null;
        this.cleanupInterval = options.cleanupInterval ?? 60000;
        this.name = options.name?.trim() || null;

        if (this.maxSize <= 0) throw new Error("maxSize must be a positive integer");

        if (options.startCleanupTimer ?? true) {
            this.startCleanupTimer();
        }

        if (this.name) {
            registerCache(this.name, this as unknown as AnyCache);
        }
    }

    public set(key: K, value: V, ttl?: number): void {
        const expiresAt = this.calculateExpiry(ttl);
        if (this.data.has(key)) {
            this.data.delete(key);
        }

        this.data.set(key, { value, expiresAt });

        if (this.data.size > this.maxSize) {
            this.evictOne();
        }
    }

    public get(key: K): V | null {
        const item = this.data.get(key);

        if (!item) {
            this.misses++;
            return null;
        }

        if (item.expiresAt !== null && Date.now() >= item.expiresAt) {
            this.data.delete(key);
            this.expiredCount++;
            this.misses++;
            return null;
        }

        this.hits++;
        return item.value;
    }

    public has(key: K): boolean {
        const item = this.data.get(key);
        if (!item) return false;

        if (item.expiresAt !== null && Date.now() >= item.expiresAt) {
            this.data.delete(key);
            this.expiredCount++;
            return false;
        }
        return true;
    }

    public delete(key: K): boolean {
        return this.data.delete(key);
    }

    public *entries(): IterableIterator<[K, V]> {
        const now = Date.now();
        for (const [key, item] of this.data.entries()) {
            if (item.expiresAt !== null && now >= item.expiresAt) {
                continue;
            }
            yield [key, item.value];
        }
    }

    public cleanup(): void {
        const now = Date.now();
        let purged = 0;

        for (const [key, item] of this.data.entries()) {
            if (item.expiresAt !== null && now >= item.expiresAt) {
                this.data.delete(key);
                purged++;
            }
        }

        if (purged > 0) {
            this.expiredCount += purged;
            log.debug(`TTLCache [Cleanup]: Removed ${purged} expired items.`);
        }
    }

    private evictOne(): void {
        const oldest = this.data.keys().next().value;
        if (oldest !== undefined) {
            this.data.delete(oldest);
            this.evictedCount++;
        }
    }

    private calculateExpiry(ttl?: number): number | null {
        const timeToLive = ttl ?? this.defaultTTL;
        return timeToLive ? Date.now() + timeToLive : null;
    }

    public get stats(): CacheStats {
        return {
            size: this.data.size,
            hits: this.hits,
            misses: this.misses,
            expired: this.expiredCount,
            evicted: this.evictedCount
        };
    }

    public clear(): void {
        this.data.clear();
        this.hits = 0;
        this.misses = 0;
    }

    public close(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        if (this.name) {
            unregisterCache(this.name, this as unknown as AnyCache);
        }
    }

    private startCleanupTimer(): void {
        if (this.cleanupTimer) return;

        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.cleanupInterval);

        this.cleanupTimer.unref();
    }
}
