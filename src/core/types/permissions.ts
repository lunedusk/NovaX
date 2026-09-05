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
    requireAll?: string[];
    requireAny?: string[];
    denyIf?: string | string[];
    denyIfAny?: string | string[];
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
    | 'INVALID_SCOPE'
    | 'FORBIDDEN';

const PERMISSION_HTTP_STATUS: Record<PermissionErrorCode, number> = {
    MISSING_BIT: 403,
    NOT_IN_GUILD: 403,
    BOT_WIDE_ONLY: 400,
    INVALID_BIT: 400,
    INVALID_SCOPE: 400,
    FORBIDDEN: 403,
};

const PERMISSION_USER_MESSAGE: Record<PermissionErrorCode, string> = {
    MISSING_BIT: 'You are missing a required permission.',
    NOT_IN_GUILD: 'This action requires a guild context.',
    BOT_WIDE_ONLY: 'This action is only available at bot-wide scope.',
    INVALID_BIT: 'One or more permission bits or roles are invalid.',
    INVALID_SCOPE: 'The permission scope is invalid.',
    FORBIDDEN: 'You are not allowed to perform this action.',
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
    scope: 'bot' | 'server' | 'plugin';
    rank: number;
}

export const BUILT_IN_BITS: BuiltInBitSeed[] = [
    { bit: 'bot.owner', description: 'Superuser bit. Granted via BotOwnerIds env and/or bot-wide roles (env owners only may assign).', scope: 'bot', rank: 900 },
    { bit: 'bot.protected', description: 'Immune to bot punishments. Only bot.owner may assign on bot-wide roles.', scope: 'bot', rank: 800 },
    { bit: 'bot.servers.view', description: 'View all servers the bot is in.', scope: 'bot', rank: 10 },
    { bit: 'bot.servers.manage', description: 'Edit server-level bot configuration.', scope: 'bot', rank: 220 },
    { bit: 'bot.servers.ban', description: 'Force-ban a server and leave.', scope: 'bot', rank: 185 },
    { bit: 'bot.members.view', description: 'View any member across all servers.', scope: 'bot', rank: 10 },
    { bit: 'bot.members.kick', description: 'Kick from any server.', scope: 'bot', rank: 130 },
    { bit: 'bot.members.ban', description: 'Ban from any server.', scope: 'bot', rank: 180 },
    { bit: 'bot.members.mute', description: 'Timeout from any server.', scope: 'bot', rank: 120 },
    { bit: 'bot.members.ban_global', description: 'Bot-wide ban across all servers simultaneously.', scope: 'bot', rank: 190 },
    { bit: 'bot.members.nick', description: 'Change nicknames across servers via moderation APIs.', scope: 'bot', rank: 100 },
    { bit: 'bot.members.role', description: 'Add/remove roles across servers via moderation APIs.', scope: 'bot', rank: 110 },
    { bit: 'bot.plugins.view', description: 'View plugin configs and status.', scope: 'bot', rank: 10 },
    { bit: 'bot.plugins.manage', description: 'Edit plugin configs and language files.', scope: 'bot', rank: 250 },
    { bit: 'bot.plugins.reload', description: 'Hot-reload a plugin.', scope: 'bot', rank: 240 },
    { bit: 'bot.roles.manage', description: 'Create/edit/delete bot-wide roles.', scope: 'bot', rank: 360 },
    { bit: 'bot.theme.manage', description: 'Edit dashboard theme.', scope: 'bot', rank: 200 },
    { bit: 'bot.dash.pages.manage', description: 'Edit dashboard landing page content.', scope: 'bot', rank: 200 },
    { bit: 'bot.logs.view', description: 'View bot-wide audit logs.', scope: 'bot', rank: 15 },
    { bit: 'bot.audit.view', description: 'Read the append-only audit registry.', scope: 'bot', rank: 15 },
    { bit: 'bot.errors.view', description: 'Read the coalesced error occurrence registry.', scope: 'bot', rank: 15 },
    { bit: 'bot.analytics.view', description: 'View bot-wide analytics.', scope: 'bot', rank: 15 },
    { bit: 'bot.tokens.view', description: 'Verify tokens and list device sessions.', scope: 'bot', rank: 20 },
    { bit: 'bot.tokens.manage', description: 'Issue, refresh, and revoke tokens.', scope: 'bot', rank: 300 },
    { bit: 'bot.permissions.view', description: 'Resolve and inspect permission bits for any user.', scope: 'bot', rank: 20 },
    { bit: 'bot.permissions.manage', description: 'Register bits and manage permission cache.', scope: 'bot', rank: 350 },
    { bit: 'bot.gates.view', description: 'List guild-gate and plugin-gate blocks.', scope: 'bot', rank: 20 },
    { bit: 'bot.gates.manage', description: 'Block or unblock guilds and plugins via guild-gate.', scope: 'bot', rank: 340 },
    { bit: 'bot.emoji.view', description: 'List and resolve custom emoji map entries.', scope: 'bot', rank: 15 },
    { bit: 'bot.emoji.manage', description: 'Reload the emoji configuration map.', scope: 'bot', rank: 200 },
    { bit: 'bot.fleet.view', description: 'View Cross-Host fleet status, load, and membership.', scope: 'bot', rank: 25 },
    { bit: 'bot.fleet.restart', description: 'Gracefully restart the full Cross-Host fleet (no reassignment).', scope: 'bot', rank: 400 },
    { bit: 'bot.shard.view', description: 'View shard assignment and metrics on this process or cluster.', scope: 'bot', rank: 25 },
    { bit: 'bot.shard.shift', description: 'Request manual shard reassignment (Cross-Host).', scope: 'bot', rank: 420 },
    { bit: 'bot.worker.restart', description: 'Gracefully restart a specific Cross-Host worker.', scope: 'bot', rank: 400 },
    { bit: 'bot.crosshost.view', description: 'Read Cross-Host maps and control-plane status.', scope: 'bot', rank: 25 },
    { bit: 'bot.crosshost.manage', description: 'Mutating Cross-Host control beyond view.', scope: 'bot', rank: 450 },
    { bit: 'bot.cache.manage', description: 'List and pop registered framework caches.', scope: 'bot', rank: 210 },
    { bit: 'bot.config.reload', description: 'Reload configuration from disk or snapshot.', scope: 'bot', rank: 230 },
    { bit: 'bot.lang.reload', description: 'Reload language namespaces.', scope: 'bot', rank: 230 },
    { bit: 'bot.audit.export', description: 'Export audit registry data.', scope: 'bot', rank: 200 },
    { bit: 'bot.errors.export', description: 'Export error occurrence registry data.', scope: 'bot', rank: 200 },
    { bit: 'bot.hierarchy.view', description: 'Inspect permission rank information (bot scope).', scope: 'bot', rank: 20 },
    { bit: 'bot.role_links.manage', description: 'Manage Discord role links to bot-wide perm roles.', scope: 'bot', rank: 360 },

    { bit: 'server.owner', description: 'Synthetic bit — auto-granted to Discord guild owner. Never stored in roles.', scope: 'server', rank: 900 },
    { bit: 'server.protected', description: 'Immune to server punishments in that guild. Only server.owner may assign via server roles.', scope: 'server', rank: 800 },
    { bit: 'server.config.view', description: 'View server plugin configs.', scope: 'server', rank: 10 },
    { bit: 'server.config.manage', description: 'Edit server plugin configs.', scope: 'server', rank: 220 },
    { bit: 'server.members.view', description: 'View server member list.', scope: 'server', rank: 10 },
    { bit: 'server.members.kick', description: 'Kick members in this server.', scope: 'server', rank: 130 },
    { bit: 'server.members.ban', description: 'Ban members in this server.', scope: 'server', rank: 180 },
    { bit: 'server.members.mute', description: 'Timeout members in this server.', scope: 'server', rank: 120 },
    { bit: 'server.members.history', description: 'View member infraction history.', scope: 'server', rank: 20 },
    { bit: 'server.members.notes', description: 'Add/view notes on members.', scope: 'server', rank: 20 },
    { bit: 'server.members.nick', description: 'Change nicknames in this server.', scope: 'server', rank: 100 },
    { bit: 'server.members.role', description: 'Add/remove Discord roles in this server via bot APIs.', scope: 'server', rank: 110 },
    { bit: 'server.roles.manage', description: 'Create/edit/delete server-scoped dashboard roles.', scope: 'server', rank: 300 },
    { bit: 'server.lang.manage', description: 'Edit server-level language overrides.', scope: 'server', rank: 200 },
    { bit: 'server.logs.view', description: 'View server audit logs.', scope: 'server', rank: 15 },
    { bit: 'server.analytics.view', description: 'View server analytics.', scope: 'server', rank: 15 },
    { bit: 'server.hierarchy.view', description: 'Inspect permission rank information in this server.', scope: 'server', rank: 20 },
    { bit: 'server.role_links.manage', description: 'Manage Discord role links to server perm roles.', scope: 'server', rank: 300 },
    { bit: 'server.discord_mirror.manage', description: 'Toggle and edit Discord permission mirror for this guild.', scope: 'server', rank: 250 },

    { bit: 'plugin.dashboard.members.notes', description: 'Add/view bot-wide (cross-server) member notes from the dashboard.', scope: 'plugin', rank: 50 },
    { bit: 'plugin.dashboard.infractions.manage', description: 'Delete infraction records from the dashboard (bot-wide or per-server).', scope: 'plugin', rank: 120 },
];

const RANK_BY_BIT = new Map<string, number>(BUILT_IN_BITS.map((b) => [b.bit, b.rank]));

export function getBitRank(bit: string): number {
    return RANK_BY_BIT.get(bit) ?? 0;
}

export function setBitRank(bit: string, rank: number): void {
    RANK_BY_BIT.set(bit, rank);
}

export function listBitRanks(): ReadonlyMap<string, number> {
    return RANK_BY_BIT;
}
