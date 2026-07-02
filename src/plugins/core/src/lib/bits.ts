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

    PLUGIN_DASHBOARD_MEMBERS_NOTES: 'plugin.dashboard.members.notes',
    PLUGIN_DASHBOARD_INFRACTIONS_MANAGE: 'plugin.dashboard.infractions.manage',
} as const;

export type BitKey = keyof typeof BITS;

export const BOT_OWNER_BIT = 'bot.owner';

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
