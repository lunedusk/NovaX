import type { PermissionsManager } from '#core/manager/permissions.js';
import type { ResolvedPermissions } from '#core/types/permissions.js';
import { cacheFacade } from '#core/manager/cacheFacade.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('PermissionCache');

const DEFAULT_TTL_SECONDS = 300;

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

interface CachedPayload {
    botOwner: boolean;
    bits: string[];
    guildId?: string;
    resolvedAt: number;
}

export class PermissionCache {
    private readonly store = cacheFacade.namespace('permissions');
    private readonly ttlSeconds: number;

    constructor(
        private readonly permissionsManager: PermissionsManager,
        ttlSeconds: number = DEFAULT_TTL_SECONDS,
    ) {
        this.ttlSeconds = ttlSeconds;
    }

    public async init(): Promise<void> {}

    private cacheId(userId: string, guildId?: string): string {
        return guildId ? `permcache_${guildId}_${userId}` : `permcache_${userId}`;
    }

    public async cachedResolve(
        userId: string,
        guildId?: string,
        discordGuildOwnerId?: string,
    ): Promise<ResolvedPermissions> {
        const id = this.cacheId(userId, guildId);
        const raw = await this.store.get(id);
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as CachedPayload;
                return {
                    botOwner: !!parsed.botOwner,
                    bits: new Set(Array.isArray(parsed.bits) ? parsed.bits.map(String) : []),
                    guildId: parsed.guildId ?? guildId,
                    resolvedAt: parsed.resolvedAt,
                };
            } catch {
                log.warn(`Corrupt cache entry for ${id}, falling back to live resolve.`);
                await this.store.delete(id);
            }
        }

        const resolved = await this.permissionsManager.resolve(userId, guildId, discordGuildOwnerId);
        const payload: CachedPayload = {
            botOwner: resolved.botOwner,
            bits: [...resolved.bits],
            guildId: resolved.guildId,
            resolvedAt: resolved.resolvedAt ?? nowSeconds(),
        };
        await this.store.set(id, JSON.stringify(payload), this.ttlSeconds * 1000);
        return resolved;
    }

    public async invalidate(userId: string, guildId?: string): Promise<void> {
        await this.store.delete(this.cacheId(userId, guildId));
    }

    public async invalidateGuild(guildId: string): Promise<void> {
        await this.store.deleteByPrefix(`permcache_${guildId}_`);
    }

    public async clearAll(): Promise<void> {
        await this.store.deleteByPrefix('permcache_');
    }
}

export let permissionCache: PermissionCache | undefined;

export function createPermissionCache(
    permissionsManager: PermissionsManager,
    ttlSeconds?: number,
): PermissionCache {
    permissionCache = new PermissionCache(permissionsManager, ttlSeconds);
    return permissionCache;
}
