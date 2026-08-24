import type { RulesValidateFn } from '#core/validation/types.js';
import { BUILT_IN_BITS } from '#core/types/permissions.js';

const KNOWN_DISCORD_PERMS = new Set([
    'CreateInstantInvite', 'KickMembers', 'BanMembers', 'Administrator',
    'ManageChannels', 'ManageGuild', 'AddReactions', 'ViewAuditLog',
    'PrioritySpeaker', 'Stream', 'ViewChannel', 'SendMessages',
    'SendTTSMessages', 'ManageMessages', 'EmbedLinks', 'AttachFiles',
    'ReadMessageHistory', 'MentionEveryone', 'UseExternalEmojis',
    'ViewGuildInsights', 'Connect', 'Speak', 'MuteMembers', 'DeafenMembers',
    'MoveMembers', 'UseVAD', 'ChangeNickname', 'ManageNicknames',
    'ManageRoles', 'ManageWebhooks', 'ManageEmojisAndStickers', 'ManageGuildExpressions',
    'UseApplicationCommands', 'RequestToSpeak', 'ManageEvents',
    'ManageThreads', 'CreatePublicThreads', 'CreatePrivateThreads',
    'UseExternalStickers', 'SendMessagesInThreads', 'UseEmbeddedActivities',
    'ModerateMembers', 'ViewCreatorMonetizationAnalytics', 'UseSoundboard',
    'CreateGuildExpressions', 'CreateEvents', 'UseExternalSounds',
    'SendVoiceMessages', 'SendPolls', 'UseExternalApps'
]);

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', '*']);
const ALLOWED_BITS_MODES = new Set(['all', 'any']);
const KNOWN_BITS = new Set(BUILT_IN_BITS.map((b) => b.bit));

export const validate: RulesValidateFn = (data) => {
    if (!data || typeof data !== 'object') return true;

    const cfg = data as {
        enabled?: boolean;
        defaultLevel?: string;
        levels?: Record<
            string,
            {
                roleIds?: string[];
                discordPermissions?: string[];
                denyMessage?: string;
            }
        >;
        httpRoutes?: Array<{
            method?: string;
            path?: string;
            bits?: string[];
            bitsMode?: string;
            public?: boolean;
        }>;
    };

    const issues: string[] = [];
    const levels = cfg.levels ?? {};
    const levelNames = Object.keys(levels);

    if (levelNames.length === 0) {
        issues.push('levels: at least one level is required');
    }

    const def = cfg.defaultLevel ?? 'public';
    if (!levels[def]) {
        issues.push(`defaultLevel "${def}" is not defined in levels`);
    }

    for (const [name, level] of Object.entries(levels)) {
        if (!/^[a-z][a-z0-9_-]*$/i.test(name)) {
            issues.push(`levels.${name}: invalid level id (use alphanumeric / _ / -)`);
        }
        for (const rid of level.roleIds ?? []) {
            if (!/^\d{17,20}$/.test(rid)) {
                issues.push(`levels.${name}.roleIds: "${rid}" is not a snowflake`);
            }
        }
        for (const p of level.discordPermissions ?? []) {
            if (!KNOWN_DISCORD_PERMS.has(p)) {
                issues.push(
                    `levels.${name}.discordPermissions: unknown permission "${p}" (check discord.js PermissionFlagsBits name)`
                );
            }
        }
        if (level.denyMessage !== undefined && !level.denyMessage.trim()) {
            issues.push(`levels.${name}.denyMessage: must not be empty when set`);
        }
    }

    const routes = Array.isArray(cfg.httpRoutes) ? cfg.httpRoutes : [];
    const seen = new Set<string>();

    for (let i = 0; i < routes.length; i++) {
        const route = routes[i] ?? {};
        const label = `httpRoutes[${i}]`;
        const method = typeof route.method === 'string' ? route.method.toUpperCase() : '';
        const path = typeof route.path === 'string' ? route.path : '';
        const bits = Array.isArray(route.bits) ? route.bits : [];
        const bitsMode = route.bitsMode === undefined ? 'all' : String(route.bitsMode);
        const isPublic = route.public === true;

        if (!path.startsWith('/')) {
            issues.push(`${label}: path must start with "/"`);
        }

        if (!ALLOWED_METHODS.has(method)) {
            issues.push(`${label}: method must be one of GET|POST|PUT|PATCH|DELETE|OPTIONS|*`);
        }

        if (!ALLOWED_BITS_MODES.has(bitsMode)) {
            issues.push(`${label}: bitsMode must be "all" or "any"`);
        }

        if (!isPublic && bits.length === 0) {
            issues.push(
                `${label}: UNGATED — non-public route ${method} ${path || '(missing path)'} has empty bits`
            );
        }

        for (const bit of bits) {
            if (typeof bit !== 'string' || !bit.trim()) {
                issues.push(`${label}: bits contains empty entry`);
                continue;
            }
            if (!KNOWN_BITS.has(bit)) {
                issues.push(`${label}: unknown bit "${bit}" (not in built-in catalogue)`);
            }
        }

        if (isPublic && bits.length > 0) {
            issues.push(
                `${label}: contradictory — public route ${method} ${path || '(missing path)'} also lists bits (bits are ignored when public)`
            );
        }

        if (method && path) {
            const key = `${method} ${path}`;
            if (seen.has(key)) {
                issues.push(`${label}: duplicate policy for ${key}`);
            } else {
                seen.add(key);
            }
        }
    }

    if (issues.length === 0) return true;
    return issues;
};

export default validate;
