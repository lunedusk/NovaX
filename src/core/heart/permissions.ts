import type { PermissionsManager } from '#core/manager/permissions.js';
import type { PermissionCache } from '#core/manager/permissionCache.js';
import { getHeartPermissions } from './holders.js';

export type PermissionsDomain = {
    readonly manager: () => PermissionsManager;
    readonly cache: () => PermissionCache | null;
    readonly hasBit: (
        userId: string,
        bit: string,
        guildId?: string,
    ) => Promise<boolean>;
    readonly requireBit: (
        userId: string,
        bit: string,
        guildId?: string,
    ) => Promise<void>;
    readonly registerBit: (
        bit: string,
        description: string,
        pluginId?: string,
        rank?: number,
    ) => Promise<void>;
    readonly listBits: (
        scope?: 'bot' | 'server' | 'plugin',
    ) => Promise<import('#core/types/permissions.js').PermBitDoc[]>;
    readonly canActOnMember: (
        actorUserId: string,
        targetUserId: string,
        guildId?: string,
        discordGuildOwnerId?: string,
    ) => Promise<import('#core/permissions/hierarchy.js').HierarchyDecision>;
};

function requireManager(): PermissionsManager {
    const { manager } = getHeartPermissions();
    if (!manager) {
        throw new Error(
            'Permissions manager is not initialized yet. Use this after the permission system boots.',
        );
    }
    return manager;
}

export const permissionsDomain: PermissionsDomain = Object.freeze({
    manager: () => requireManager(),
    cache: () => getHeartPermissions().cache,
    hasBit: (userId, bit, guildId) => requireManager().hasBit(userId, bit, guildId),
    requireBit: (userId, bit, guildId) => requireManager().requireBit(userId, bit, guildId),
    registerBit: (bit, description, pluginId, rank) =>
        requireManager().registerBit(bit, description, pluginId, rank),
    listBits: (scope) => requireManager().listBits(scope),
    canActOnMember: (actorUserId, targetUserId, guildId, discordGuildOwnerId) =>
        requireManager().canActOnMember(actorUserId, targetUserId, guildId, discordGuildOwnerId),
});
