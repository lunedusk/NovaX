import type { RulesValidateFn } from '#core/validation/types.js';

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

    if (issues.length === 0) return true;
    return issues;
};

export default validate;