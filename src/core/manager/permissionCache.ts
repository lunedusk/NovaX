import { DatabaseManager } from '#core/database/index.js';
import type { PermissionsManager } from '#core/manager/permissions.js';
import type { ResolvedPermissions } from '#core/types/permissions.js';
import { getLogger } from '#core/utils/logger.js';
import { sqliteDB } from '#core/database/sqlite.js';  

const log = getLogger('PermissionCache');

interface SqliteDb {
    prepare(sql: string): {
        run: (...params: unknown[]) => unknown;
        get: (...params: unknown[]) => any;
        all: (...params: unknown[]) => any[];
    };
    exec(sql: string): void;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
}

const DEFAULT_TTL_SECONDS = 300;

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

export class PermissionCache {

    private readonly dbAlias = 'main';
    private db!: SqliteDb;

    constructor(
        private readonly permissionsManager: PermissionsManager,
        private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS,
    ) {}

    public async init(): Promise<void> {
        this.db = sqliteDB.get(this.dbAlias) as unknown as SqliteDb;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS perm_users (
                id              TEXT PRIMARY KEY,
                userId          TEXT NOT NULL,
                guildId         TEXT,
                botOwner        INTEGER NOT NULL DEFAULT 0,
                resolvedBits    TEXT NOT NULL DEFAULT '[]',
                resolvedAt      INTEGER NOT NULL,
                cacheTtlSeconds INTEGER NOT NULL DEFAULT 300
            );
            CREATE INDEX IF NOT EXISTS idx_perm_users_guild ON perm_users(guildId);
        `);
    }

    private cacheId(userId: string, guildId?: string): string {
        return guildId ? `permcache_${guildId}_${userId}` : `permcache_${userId}`;
    }

    public async cachedResolve(userId: string, guildId?: string, discordGuildOwnerId?: string): Promise<ResolvedPermissions> {
        const id = this.cacheId(userId, guildId);
        const row = this.db.prepare(`SELECT * FROM perm_users WHERE id = ?`).get(id);

        if (row && (nowSeconds() - row.resolvedAt) < (row.cacheTtlSeconds ?? this.ttlSeconds)) {
            try {
                const parsed = JSON.parse(row.resolvedBits);
                return {
                    botOwner: !!row.botOwner,
                    bits: new Set(Array.isArray(parsed) ? parsed.map(String) : []),
                    guildId,
                    resolvedAt: row.resolvedAt,
                };
            } catch {
                log.warn(`Corrupt cache entry for ${id}, falling back to live resolve.`);
            }
        }

        const resolved = await this.permissionsManager.resolve(userId, guildId, discordGuildOwnerId);
        const bits = [...resolved.bits];

        this.db.prepare(`
            INSERT INTO perm_users (id, userId, guildId, botOwner, resolvedBits, resolvedAt, cacheTtlSeconds)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                botOwner = excluded.botOwner,
                resolvedBits = excluded.resolvedBits,
                resolvedAt = excluded.resolvedAt,
                cacheTtlSeconds = excluded.cacheTtlSeconds
        `).run(id, userId, guildId ?? null, resolved.botOwner ? 1 : 0, JSON.stringify(bits), nowSeconds(), this.ttlSeconds);

        return resolved;
    }

    public async invalidate(userId: string, guildId?: string): Promise<void> {
        this.db.prepare(`DELETE FROM perm_users WHERE id = ?`).run(this.cacheId(userId, guildId));
    }

    public async invalidateGuild(guildId: string): Promise<void> {
        const prefix = `permcache_${guildId}_`;
        this.db.prepare(`DELETE FROM perm_users WHERE id >= ? AND id < ?`)
            .run(prefix, prefix + '\uffff');
    }

    public async clearAll(): Promise<void> {
        this.db.prepare(`DELETE FROM perm_users`).run();
    }
}

export let permissionCache: PermissionCache | undefined;

export function createPermissionCache(permissionsManager: PermissionsManager, ttlSeconds?: number): PermissionCache {
    permissionCache = new PermissionCache(permissionsManager, ttlSeconds);
    return permissionCache;
}
