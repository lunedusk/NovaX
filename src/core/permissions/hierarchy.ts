import { getBitRank } from '#core/types/permissions.js';
import type { ResolvedPermissions } from '#core/types/permissions.js';
import { secrets } from '#core/helpers/secretManager.js';

export type HierarchyScope = 'bot' | 'server' | 'any';

export type HierarchyDenialCode =
    | 'env_owner_protected'
    | 'target_rank_too_high'
    | 'equal_rank'
    | 'missing_actor'
    | 'unknown_target';

export interface HierarchyDecision {
    readonly allowed: boolean;
    readonly code?: HierarchyDenialCode;
    readonly actorRank: number;
    readonly targetRank: number;
}

function envOwnerIds(): ReadonlySet<string> {
    const raw = secrets.getOptional('BotOwnerIds', '') ?? '';
    return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

export function isEnvBotOwner(userId: string | null | undefined): boolean {
    if (!userId) return false;
    return envOwnerIds().has(userId);
}

export function rankFromBits(bits: Iterable<string>): number {
    let max = 0;
    for (const b of bits) {
        const r = getBitRank(b);
        if (r > max) max = r;
    }
    return max;
}

export function rankFromResolved(resolved: ResolvedPermissions): number {
    if (resolved.botOwner) {
        return Math.max(900, rankFromBits(resolved.bits));
    }
    return rankFromBits(resolved.bits);
}

export function canActOnMember(options: {
    readonly actorUserId: string;
    readonly targetUserId: string;
    readonly actor: ResolvedPermissions;
    readonly target: ResolvedPermissions;
    readonly scope?: HierarchyScope;
}): HierarchyDecision {
    const scope = options.scope ?? 'any';
    const actorId = options.actorUserId;
    const targetId = options.targetUserId;

    if (actorId === targetId) {
        return { allowed: false, code: 'equal_rank', actorRank: 0, targetRank: 0 };
    }

    if (isEnvBotOwner(targetId) && !isEnvBotOwner(actorId)) {
        return {
            allowed: false,
            code: 'env_owner_protected',
            actorRank: rankFromResolved(options.actor),
            targetRank: Number.POSITIVE_INFINITY,
        };
    }

    if (isEnvBotOwner(actorId)) {
        return {
            allowed: true,
            actorRank: Number.POSITIVE_INFINITY,
            targetRank: rankFromResolved(options.target),
        };
    }

    const actorIsBotOwner =
        options.actor.botOwner || options.actor.bits.has('bot.owner');
    const targetIsBotOwner =
        options.target.botOwner || options.target.bits.has('bot.owner');

    if (actorIsBotOwner && !isEnvBotOwner(targetId)) {
        if (scope === 'bot' || scope === 'any') {
            return {
                allowed: true,
                actorRank: 900,
                targetRank: rankFromResolved(options.target),
            };
        }
    }

    if (
        (scope === 'server' || scope === 'any') &&
        options.actor.bits.has('server.owner')
    ) {
        return {
            allowed: true,
            actorRank: 900,
            targetRank: rankFromResolved(options.target),
        };
    }

    if (targetIsBotOwner && !actorIsBotOwner) {
        return {
            allowed: false,
            code: 'target_rank_too_high',
            actorRank: rankFromResolved(options.actor),
            targetRank: 900,
        };
    }

    const actorRank = rankFromResolved(options.actor);
    const targetRank = rankFromResolved(options.target);

    if (actorRank > targetRank) {
        return { allowed: true, actorRank, targetRank };
    }

    return {
        allowed: false,
        code: actorRank === targetRank ? 'equal_rank' : 'target_rank_too_high',
        actorRank,
        targetRank,
    };
}

export function actorHoldsAllBits(
    actorUserId: string | null | undefined,
    actor: ResolvedPermissions,
    requiredBits: readonly string[],
): { ok: true } | { ok: false; missing: string[] } {
    if (isEnvBotOwner(actorUserId) || actor.botOwner || actor.bits.has('bot.owner')) {
        return { ok: true };
    }
    if (actor.bits.has('server.owner')) {
        const missing = requiredBits.filter((b) => b.startsWith('bot.'));
        if (missing.length === 0) return { ok: true };
        return { ok: false, missing };
    }
    const missing = requiredBits.filter((b) => !actor.bits.has(b));
    if (missing.length === 0) return { ok: true };
    return { ok: false, missing };
}

export function filterBitsActorMayGrant(
    actorUserId: string | null | undefined,
    actor: ResolvedPermissions,
    bits: readonly string[],
): { allowed: string[]; denied: string[] } {
    if (isEnvBotOwner(actorUserId) || actor.botOwner || actor.bits.has('bot.owner')) {
        return { allowed: [...bits], denied: [] };
    }
    const allowed: string[] = [];
    const denied: string[] = [];
    for (const b of bits) {
        if (actor.bits.has(b)) allowed.push(b);
        else denied.push(b);
    }
    return { allowed, denied };
}
