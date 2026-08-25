import { type IHeart } from '#core/heart/index.js';
import { HttpError } from './http.js';
import type PermissionsHandler from '../../../permissions/src/handlers/manager.js';
import type { BotWideRoleDoc, ServerRoleDoc } from '#core/types/permissions.js';

export function permissions(heart: IHeart): PermissionsHandler {
    const handler = heart.system.handler.$get('permissions', 'manager') as PermissionsHandler | undefined;
    if (!handler) {
        throw new HttpError(500, 'internal', 'permissions plugin handler unavailable.');
    }
    return handler;
}

export async function findBotRole(heart: IHeart, roleId: string): Promise<BotWideRoleDoc | null> {
    const roles = await permissions(heart).listBotRoles();
    return roles.find((r) => r._id === roleId) ?? null;
}

export async function findServerRole(heart: IHeart, guildId: string, roleId: string): Promise<ServerRoleDoc | null> {
    const roles = await permissions(heart).listServerRoles(guildId);
    return roles.find((r) => r._id === roleId) ?? null;
}
