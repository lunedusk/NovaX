export const BITS = {
    BOT_SERVERS_VIEW: 'bot.servers.view',
    BOT_SERVERS_MANAGE: 'bot.servers.manage',
    BOT_SERVERS_BAN: 'bot.servers.ban',
    BOT_MEMBERS_VIEW: 'bot.members.view',
    BOT_MEMBERS_KICK: 'bot.members.kick',
    BOT_MEMBERS_BAN: 'bot.members.ban',
    BOT_MEMBERS_MUTE: 'bot.members.mute',
    BOT_MEMBERS_BAN_GLOBAL: 'bot.members.ban_global',
    BOT_PLUGINS_VIEW: 'bot.plugins.view',
    BOT_PLUGINS_MANAGE: 'bot.plugins.manage',
    BOT_PLUGINS_RELOAD: 'bot.plugins.reload',
    BOT_ROLES_MANAGE: 'bot.roles.manage',
    BOT_THEME_MANAGE: 'bot.theme.manage',
    BOT_DASH_PAGES_MANAGE: 'bot.dash.pages.manage',
    BOT_LOGS_VIEW: 'bot.logs.view',
    BOT_ANALYTICS_VIEW: 'bot.analytics.view',
    BOT_FLEET_VIEW: 'bot.fleet.view',
    BOT_FLEET_RESTART: 'bot.fleet.restart',
    BOT_SHARD_VIEW: 'bot.shard.view',
    BOT_SHARD_SHIFT: 'bot.shard.shift',
    BOT_WORKER_RESTART: 'bot.worker.restart',
    BOT_CROSSHOST_VIEW: 'bot.crosshost.view',
    BOT_CROSSHOST_MANAGE: 'bot.crosshost.manage',
    BOT_CACHE_MANAGE: 'bot.cache.manage',
    BOT_CONFIG_RELOAD: 'bot.config.reload',
    BOT_LANG_RELOAD: 'bot.lang.reload',
    BOT_AUDIT_EXPORT: 'bot.audit.export',
    BOT_ERRORS_EXPORT: 'bot.errors.export',
    BOT_MEMBERS_NICK: 'bot.members.nick',
    BOT_MEMBERS_ROLE: 'bot.members.role',
    BOT_HIERARCHY_VIEW: 'bot.hierarchy.view',
    BOT_ROLE_LINKS_MANAGE: 'bot.role_links.manage',

    SERVER_CONFIG_VIEW: 'server.config.view',
    SERVER_CONFIG_MANAGE: 'server.config.manage',
    SERVER_MEMBERS_VIEW: 'server.members.view',
    SERVER_MEMBERS_KICK: 'server.members.kick',
    SERVER_MEMBERS_BAN: 'server.members.ban',
    SERVER_MEMBERS_MUTE: 'server.members.mute',
    SERVER_MEMBERS_HISTORY: 'server.members.history',
    SERVER_MEMBERS_NOTES: 'server.members.notes',
    SERVER_ROLES_MANAGE: 'server.roles.manage',
    SERVER_LANG_MANAGE: 'server.lang.manage',
    SERVER_LOGS_VIEW: 'server.logs.view',
    SERVER_ANALYTICS_VIEW: 'server.analytics.view',
    SERVER_MEMBERS_NICK: 'server.members.nick',
    SERVER_MEMBERS_ROLE: 'server.members.role',
    SERVER_HIERARCHY_VIEW: 'server.hierarchy.view',
    SERVER_ROLE_LINKS_MANAGE: 'server.role_links.manage',
    SERVER_DISCORD_MIRROR_MANAGE: 'server.discord_mirror.manage',

    PLUGIN_DASHBOARD_MEMBERS_NOTES: 'plugin.dashboard.members.notes',
    PLUGIN_DASHBOARD_INFRACTIONS_MANAGE: 'plugin.dashboard.infractions.manage',
} as const;

export type BitKey = keyof typeof BITS;

export const BOT_OWNER_BIT = 'bot.owner';
export const BOT_PROTECTED_BIT = 'bot.protected';
export const SERVER_PROTECTED_BIT = 'server.protected';

export const PROTECTED_BITS = {
    BOT: BOT_PROTECTED_BIT,
    SERVER: SERVER_PROTECTED_BIT,
} as const;

export const CUSTOM_BITS_TO_REGISTER: Array<{ bit: string; description: string }> = [
    {
        bit: BITS.PLUGIN_DASHBOARD_MEMBERS_NOTES,
        description: 'Add/view bot-wide (cross-server) member notes from the dashboard.',
    },
    {
        bit: BITS.PLUGIN_DASHBOARD_INFRACTIONS_MANAGE,
        description: 'Delete infraction records from the dashboard (bot-wide or per-server).',
    },
];
