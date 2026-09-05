import {
    DiscordAPIError,
    type GuildMember,
    type Interaction,
    type InteractionReplyOptions,
    MessageFlags,
} from 'discord.js';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';
import { i18n } from '#core/manager/lang.js';
import { resolveGlobalPlaceholders } from '#core/placeholder/index.js';
import { permissionsManager } from '#core/manager/permissions.js';
import { BOT_OWNER_BIT, BOT_PROTECTED_BIT, SERVER_PROTECTED_BIT } from './bits.js';

export type DiscordActionCode =
    | 'permission_denied'
    | 'missing_bit'
    | 'hierarchy'
    | 'target_is_owner'
    | 'target_is_protected'
    | 'target_is_bot_protected'
    | 'target_is_server_protected'
    | 'target_is_self'
    | 'target_is_bot'
    | 'bot_missing_perms'
    | 'not_in_guild'
    | 'unknown_member'
    | 'unknown_guild'
    | 'unknown_role'
    | 'unknown_channel'
    | 'unknown_user'
    | 'rate_limited'
    | 'api_error'
    | 'action_failed'
    | 'invalid_duration'
    | 'invalid_target'
    | 'partial_failure'
    | 'not_available_here'
    | 'fleet_unreachable';

export type PunishAction =
    | 'ban'
    | 'unban'
    | 'kick'
    | 'timeout'
    | 'untimeout'
    | 'role_add'
    | 'role_remove'
    | 'nick_set'
    | 'nick_revert';

const LANG_NS = 'core';

const BOT_ILLEGAL_ACTIONS: ReadonlySet<PunishAction> = new Set(['timeout']);

export type DiscordActionVars = Record<string, string | number | boolean | null | undefined>;

export interface ClassifiedDiscordAction {
    readonly code: DiscordActionCode;
    readonly vars: DiscordActionVars;
}

export function discordActionMessage(code: DiscordActionCode, vars?: DiscordActionVars): string {
    if (
        code === 'hierarchy' &&
        vars &&
        (vars.actorRank != null || vars.targetRank != null)
    ) {
        const ranked = i18n.get(LANG_NS, 'errors.codes.HIERARCHY_RANK', {
            actorRank: vars.actorRank ?? '?',
            targetRank: vars.targetRank ?? '?',
        } as Record<string, string | number>);
        if (ranked !== `${LANG_NS}:errors.codes.HIERARCHY_RANK`) {
            return ranked;
        }
    }
    const key = `errors.discord.${code}`;
    const msg = i18n.get(LANG_NS, key, vars as Record<string, string | number> | undefined);
    if (msg === `${LANG_NS}:${key}`) {
        return i18n.get(LANG_NS, 'errors.discord.action_failed', {
            reason: vars?.reason != null ? String(vars.reason) : code,
        });
    }
    return msg;
}

export function discordActionTitle(code: DiscordActionCode): string {
    const key = `errors.discord.titles.${code}`;
    const title = i18n.get(LANG_NS, key);
    if (title === `${LANG_NS}:${key}`) {
        return i18n.get(LANG_NS, 'errors.discord.titles.action_failed');
    }
    return title;
}

export function classifyDiscordError(err: unknown): ClassifiedDiscordAction {
    if (err instanceof DiscordAPIError) {
        const code = err.code;
        const message = err.message;
        switch (code) {
            case 50013:
                return { code: 'permission_denied', vars: { code, message } };
            case 50001:
                return { code: 'bot_missing_perms', vars: { code, message } };
            case 50035:
                return { code: 'invalid_target', vars: { code, message } };
            case 10007:
                return { code: 'unknown_member', vars: { code, message } };
            case 10004:
                return { code: 'unknown_guild', vars: { code, message } };
            case 10011:
                return { code: 'unknown_role', vars: { code, message } };
            case 10003:
                return { code: 'unknown_channel', vars: { code, message } };
            case 10013:
                return { code: 'unknown_user', vars: { code, message } };
            case 30010:
            case 30013:
            case 40062:
                return { code: 'rate_limited', vars: { code, message } };
            default:
                return {
                    code: 'api_error',
                    vars: { code: String(code), message },
                };
        }
    }

    if (err && typeof err === 'object' && 'code' in err) {
        const code = (err as { code: unknown }).code;
        if (code === 429) return { code: 'rate_limited', vars: {} };
        if (code === 10007) return { code: 'unknown_member', vars: {} };
        if (code === 10011) return { code: 'unknown_role', vars: {} };
        if (code === 10004) return { code: 'unknown_guild', vars: {} };
        if (code === 10013) return { code: 'unknown_user', vars: {} };
    }

    const message = err instanceof Error ? err.message : String(err);
    return { code: 'action_failed', vars: { reason: message } };
}

export function classifyBotTarget(
    action: PunishAction,
    targetIsBot: boolean,
): DiscordActionCode | null {
    if (!targetIsBot) return null;
    if (BOT_ILLEGAL_ACTIONS.has(action)) return 'target_is_bot';
    return null;
}

export async function classifyProtectedOrOwnerTarget(
    targetUserId: string,
    guildId?: string | null,
    actorUserId?: string | null,
): Promise<DiscordActionCode | null> {
    try {
        if (!permissionsManager) return null;
        const { isEnvBotOwner } = await import('#core/permissions/hierarchy.js');

        if (isEnvBotOwner(targetUserId) && !isEnvBotOwner(actorUserId ?? undefined)) {
            return 'target_is_owner';
        }

        if (actorUserId) {
            const decision = await permissionsManager.canActOnMember(
                actorUserId,
                targetUserId,
                guildId ?? undefined,
            );
            if (!decision.allowed) {
                if (decision.code === 'env_owner_protected') return 'target_is_owner';
                if (decision.code === 'target_rank_too_high' || decision.code === 'equal_rank') {
                    const target = await permissionsManager.resolve(
                        targetUserId,
                        guildId ?? undefined,
                    );
                    if (target.bits.has(BOT_PROTECTED_BIT)) return 'target_is_bot_protected';
                    if (guildId && target.bits.has(SERVER_PROTECTED_BIT)) {
                        return 'target_is_server_protected';
                    }
                    if (target.botOwner || target.bits.has(BOT_OWNER_BIT)) {
                        return 'target_is_owner';
                    }
                    return 'hierarchy';
                }
            }
            return null;
        }

        const resolved = await permissionsManager.resolve(targetUserId, guildId ?? undefined);
        if (resolved.bits.has(BOT_OWNER_BIT) || resolved.botOwner) {
            return 'target_is_owner';
        }
        if (resolved.bits.has(BOT_PROTECTED_BIT)) {
            return 'target_is_bot_protected';
        }
        if (guildId && resolved.bits.has(SERVER_PROTECTED_BIT)) {
            return 'target_is_server_protected';
        }
    } catch {
        return null;
    }
    return null;
}

export function classifyHierarchy(
    me: GuildMember | null | undefined,
    target: GuildMember | null | undefined,
): DiscordActionCode | null {
    if (!me || !target) return null;
    if (!target.manageable) return 'hierarchy';
    if (me.roles.highest.position <= target.roles.highest.position && me.id !== target.guild.ownerId) {
        return 'hierarchy';
    }
    return null;
}

export async function classifyPunishmentTarget(input: {
    action: PunishAction;
    actorUserId: string;
    targetUserId: string;
    targetIsBot: boolean;
    guildId?: string | null;
    me?: GuildMember | null;
    targetMember?: GuildMember | null;
}): Promise<ClassifiedDiscordAction | null> {
    if (input.actorUserId === input.targetUserId) {
        return { code: 'target_is_self', vars: {} };
    }

    const botOnly = classifyBotTarget(input.action, input.targetIsBot);
    if (botOnly) return { code: botOnly, vars: {} };

    const protectedOrOwner = await classifyProtectedOrOwnerTarget(
        input.targetUserId,
        input.guildId,
        input.actorUserId,
    );
    if (protectedOrOwner) return { code: protectedOrOwner, vars: {} };

    const hierarchy = classifyHierarchy(input.me, input.targetMember);
    if (hierarchy) {
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('permissions.hierarchy.denied', {
                    actorUserId: input.actorUserId,
                    targetUserId: input.targetUserId,
                    guildId: input.guildId ?? null,
                    action: input.action,
                    code: hierarchy,
                    at: Date.now(),
                }),
            )
            .catch(() => undefined);
        return { code: hierarchy, vars: {} };
    }

    return null;
}

export function buildDiscordActionCv2(
    code: DiscordActionCode,
    vars?: DiscordActionVars,
    ephemeral = true,
): InteractionReplyOptions {
    const title = discordActionTitle(code);
    const details = discordActionMessage(code, vars);
    const rawJson = i18n.get(LANG_NS, 'layouts.containerError', { title });
    let layout: Cv2LayoutSpec;
    try {
        layout = JSON.parse(rawJson) as Cv2LayoutSpec;
    } catch {
        return {
            content: resolveGlobalPlaceholders(`%%emoji_cross%% **${title}**\n${details}`),
            flags: ephemeral ? [MessageFlags.Ephemeral] : [],
        };
    }

    const container = layout.components[0] as {
        type: string;
        children?: Array<{ type: string; content?: string }>;
    };
    const detailsChild = container?.children?.[2];
    if (detailsChild && detailsChild.type === 'text') {
        detailsChild.content = details;
    }

    const built = buildComponentsV2(layout);
    return {
        ...built,
        flags: ephemeral
            ? MessageFlags.Ephemeral
            : built.flags,
    };
}

export async function replyDiscordActionError(
    interaction: Interaction,
    code: DiscordActionCode,
    vars?: DiscordActionVars,
    ephemeral = true,
): Promise<void> {
    if (!interaction.isRepliable()) return;
    const payload = buildDiscordActionCv2(code, vars, ephemeral);
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
    } else {
        await interaction.reply(payload);
    }
}

export async function replyFromUnknownError(
    interaction: Interaction,
    err: unknown,
    ephemeral = true,
): Promise<void> {
    const classified = classifyDiscordError(err);
    await replyDiscordActionError(interaction, classified.code, classified.vars, ephemeral);
}
