import { NovaError } from '#core/errors/NovaError.js';
export interface PermBitDoc {
    _id: string;
    description: string;
    scope: 'bot' | 'server' | 'plugin';
    pluginId?: string;
    builtIn: boolean;
    createdAt: number;
}

export interface BotWideRoleDoc {
    _id: string;
    name: string;
    color: string;
    bits: string[];
    assignedUserIds: string[];
    createdAt: number;
    createdBy: string;
    updatedAt: number;
}

export interface ServerRoleDoc {
    _id: string;
    guildId: string;
    name: string;
    color: string;
    bits: string[];
    assignedUserIds: string[];
    createdAt: number;
    createdBy: string;
    updatedAt: number;
}

export interface PermUserCacheDoc {
    _id: string;
    userId: string;
    guildId?: string;
    resolvedBits: string[];
    resolvedAt: number;
    cacheTtlSeconds: number;
}

export interface ResolvedPermissions {
    botOwner: boolean;
    bits: ReadonlySet<string>;
    guildId?: string;
    resolvedAt: number;
}

export interface InteractionAccess {
    require?: string | string[] | ((resolved: ResolvedPermissions) => boolean);
    serverBit?: string | string[];
    allowInDm?: boolean;
    denyMessage?: string;
}

export interface PermissionCheckResult {
    allowed: boolean;
    reason: string;
    ephemeral: boolean;
}

export interface CreateBotRoleInput {
    name: string;
    color: string;
    bits: string[];
    createdBy: string;
}

export interface CreateServerRoleInput {
    name: string;
    color: string;
    bits: string[];
    createdBy: string;
}

export type PermissionErrorCode =
    | 'MISSING_BIT'
    | 'NOT_IN_GUILD'
    | 'BOT_WIDE_ONLY'
    | 'INVALID_BIT'
    | 'INVALID_SCOPE';

const PERMISSION_HTTP_STATUS: Record<PermissionErrorCode, number> = {
    MISSING_BIT: 403,
    NOT_IN_GUILD: 403,
    BOT_WIDE_ONLY: 400,
    INVALID_BIT: 400,
    INVALID_SCOPE: 400,
};

const PERMISSION_USER_MESSAGE: Record<PermissionErrorCode, string> = {
    MISSING_BIT: 'You are missing a required permission.',
    NOT_IN_GUILD: 'This action requires a guild context.',
    BOT_WIDE_ONLY: 'This action is only available at bot-wide scope.',
    INVALID_BIT: 'One or more permission bits or roles are invalid.',
    INVALID_SCOPE: 'The permission scope is invalid.',
};

export class PermissionError extends NovaError {
    readonly permissionCode: PermissionErrorCode;

    constructor(code: PermissionErrorCode, message: string) {
        super(message, {
            code: `PERMISSION.${code}`,
            category: 'permission',
            severity: 'error',
            userMessage: PERMISSION_USER_MESSAGE[code],
            statusCode: PERMISSION_HTTP_STATUS[code],
            details: { code },
        });
        this.name = 'PermissionError';
        this.permissionCode = code;
    }
}

interface BuiltInBitSeed {
    bit: string;
    description: string;
    scope: 'bot' | 'server';
}

export const BUILT_IN_BITS: BuiltInBitSeed[] = [
    { bit: 'bot.owner', description: 'Synthetic superuser bit. Never stored in roles — resolved from env only.', scope: 'bot' },
    { bit: 'bot.servers.view', description: 'View all servers the bot is in.', scope: 'bot' },
    { bit: 'bot.servers.manage', description: 'Edit server-level bot configuration.', scope: 'bot' },
    { bit: 'bot.servers.ban', description: 'Force-ban a server and leave.', scope: 'bot' },
    { bit: 'bot.members.view', description: 'View any member across all servers.', scope: 'bot' },
    { bit: 'bot.members.kick', description: 'Kick from any server.', scope: 'bot' },
    { bit: 'bot.members.ban', description: 'Ban from any server.', scope: 'bot' },
    { bit: 'bot.members.mute', description: 'Timeout from any server.', scope: 'bot' },
    { bit: 'bot.members.ban_global', description: 'Bot-wide ban across all servers simultaneously.', scope: 'bot' },
    { bit: 'bot.plugins.view', description: 'View plugin configs and status.', scope: 'bot' },
    { bit: 'bot.plugins.manage', description: 'Edit plugin configs and language files.', scope: 'bot' },
    { bit: 'bot.plugins.reload', description: 'Hot-reload a plugin.', scope: 'bot' },
    { bit: 'bot.roles.manage', description: 'Create/edit/delete bot-wide roles.', scope: 'bot' },
    { bit: 'bot.theme.manage', description: 'Edit dashboard theme.', scope: 'bot' },
    { bit: 'bot.dash.pages.manage', description: 'Edit dashboard landing page content.', scope: 'bot' },
    { bit: 'bot.logs.view', description: 'View bot-wide audit logs.', scope: 'bot' },
    { bit: 'bot.audit.view', description: 'Read the append-only audit registry.', scope: 'bot' },
    { bit: 'bot.errors.view', description: 'Read the coalesced error occurrence registry.', scope: 'bot' },
    { bit: 'bot.analytics.view', description: 'View bot-wide analytics.', scope: 'bot' },
    { bit: 'bot.tokens.view', description: 'Verify tokens and list device sessions.', scope: 'bot' },
    { bit: 'bot.tokens.manage', description: 'Issue, refresh, and revoke tokens.', scope: 'bot' },
    { bit: 'bot.permissions.view', description: 'Resolve and inspect permission bits for any user.', scope: 'bot' },
    { bit: 'bot.permissions.manage', description: 'Register bits and manage permission cache.', scope: 'bot' },
    { bit: 'bot.gates.view', description: 'List guild-gate and plugin-gate blocks.', scope: 'bot' },
    { bit: 'bot.gates.manage', description: 'Block or unblock guilds and plugins via guild-gate.', scope: 'bot' },
    { bit: 'bot.emoji.view', description: 'List and resolve custom emoji map entries.', scope: 'bot' },
    { bit: 'bot.emoji.manage', description: 'Reload the emoji configuration map.', scope: 'bot' },
    { bit: 'server.owner', description: 'Synthetic bit — auto-granted to Discord guild owner. Never stored in roles.', scope: 'server' },
    { bit: 'server.config.view', description: 'View server plugin configs.', scope: 'server' },
    { bit: 'server.config.manage', description: 'Edit server plugin configs.', scope: 'server' },
    { bit: 'server.members.view', description: 'View server member list.', scope: 'server' },
    { bit: 'server.members.kick', description: 'Kick members in this server.', scope: 'server' },
    { bit: 'server.members.ban', description: 'Ban members in this server.', scope: 'server' },
    { bit: 'server.members.mute', description: 'Timeout members in this server.', scope: 'server' },
    { bit: 'server.members.history', description: 'View member infraction history.', scope: 'server' },
    { bit: 'server.members.notes', description: 'Add/view notes on members.', scope: 'server' },
    { bit: 'server.roles.manage', description: 'Create/edit/delete server-scoped dashboard roles.', scope: 'server' },
    { bit: 'server.lang.manage', description: 'Edit server-level language overrides.', scope: 'server' },
    { bit: 'server.logs.view', description: 'View server audit logs.', scope: 'server' },
    { bit: 'server.analytics.view', description: 'View server analytics.', scope: 'server' },
];