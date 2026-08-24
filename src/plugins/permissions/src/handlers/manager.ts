import { BaseHandler } from '#core/bases/Handler.js';
import { permissionsManager } from '#core/manager/permissions.js';
import { permissionCache } from '#core/manager/permissionCache.js';
import type { PermissionsManager } from '#core/manager/permissions.js';
import type { PermissionCache } from '#core/manager/permissionCache.js';
import type {
    ResolvedPermissions,
    BotWideRoleDoc,
    ServerRoleDoc,
    PermBitDoc,
    CreateBotRoleInput,
    CreateServerRoleInput,
} from '#core/types/permissions.js';

export default class PermissionsHandler extends BaseHandler {

    public readonly name = 'manager';
    public readonly version = '1.0.0';
    public readonly description = 'Permission system management API for inter-plugin access.';

    private mgr!: PermissionsManager;
    private _cache?: PermissionCache;

    public async onInitialize(): Promise<void> {
        if (!permissionsManager) {
            throw new Error('Core PermissionsManager has not been initialized.');
        }
        this.mgr = permissionsManager;
        this._cache = permissionCache;
        this.log.info('Permissions handler ready.');
    }

    public async onTeardown(): Promise<void> {
        this.log.info('Permissions handler torn down.');
    }

    public async listBotRoles(): Promise<BotWideRoleDoc[]> {
        return this.mgr.listBotRoles();
    }

    public async listServerRoles(guildId: string): Promise<ServerRoleDoc[]> {
        return this.mgr.listServerRoles(guildId);
    }

    public async createBotRole(data: CreateBotRoleInput, actorUserId?: string | null): Promise<BotWideRoleDoc> {
        return this.mgr.createBotRole(data, actorUserId);
    }

    public async createServerRole(guildId: string, data: CreateServerRoleInput): Promise<ServerRoleDoc> {
        return this.mgr.createServerRole(guildId, data);
    }

    public async deleteBotRole(roleId: string, actorUserId?: string | null): Promise<void> {
        return this.mgr.deleteBotRole(roleId, actorUserId);
    }

    public async deleteServerRole(guildId: string, roleId: string): Promise<void> {
        return this.mgr.deleteServerRole(guildId, roleId);
    }

    public async updateBotRole(roleId: string, data: Partial<CreateBotRoleInput>, actorUserId?: string | null): Promise<BotWideRoleDoc> {
        return this.mgr.updateBotRole(roleId, data, actorUserId);
    }

    public async updateServerRole(guildId: string, roleId: string, data: Partial<CreateServerRoleInput>): Promise<ServerRoleDoc> {
        return this.mgr.updateServerRole(guildId, roleId, data);
    }

    public async assignBotRole(roleId: string, userIds: string[], actorUserId?: string | null): Promise<void> {
        return this.mgr.assignBotRole(roleId, userIds, actorUserId);
    }

    public async assignServerRole(guildId: string, roleId: string, userIds: string[]): Promise<void> {
        return this.mgr.assignServerRole(guildId, roleId, userIds);
    }

    public async revokeBotRole(roleId: string, userIds: string[], actorUserId?: string | null): Promise<void> {
        return this.mgr.revokeBotRole(roleId, userIds, actorUserId);
    }

    public async revokeServerRole(guildId: string, roleId: string, userIds: string[]): Promise<void> {
        return this.mgr.revokeServerRole(guildId, roleId, userIds);
    }

    public async listBits(scope?: 'bot' | 'server' | 'plugin'): Promise<PermBitDoc[]> {
        return this.mgr.listBits(scope);
    }

    public async registerBit(bit: string, description: string, pluginId?: string): Promise<void> {
        return this.mgr.registerBit(bit, description, pluginId);
    }

    public async resolve(userId: string, guildId?: string, discordGuildOwnerId?: string): Promise<ResolvedPermissions> {
        return this.mgr.cachedResolve(userId, guildId, discordGuildOwnerId);
    }

    public async hasBit(userId: string, bit: string, guildId?: string): Promise<boolean> {
        return this.mgr.hasBit(userId, bit, guildId);
    }

    public async invalidateUser(userId: string, guildId?: string): Promise<void> {
        return this.mgr.invalidateUserCache(userId, guildId);
    }

    public async invalidateGuild(guildId: string): Promise<void> {
        return this.mgr.invalidateGuildCache(guildId);
    }

    public async clearCache(): Promise<void> {
        if (this._cache) {
            await this._cache.clearAll();
        }
    }
}
