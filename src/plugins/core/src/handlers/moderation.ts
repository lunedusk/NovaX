import {
    PermissionFlagsBits,
    type Client,
    type Guild,
    type GuildMember,
} from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import {
    classifyPunishmentTarget,
    classifyDiscordError,
    type DiscordActionCode,
    type PunishAction,
    type ClassifiedDiscordAction,
} from '../lib/discordActionErrors.js';
import { normalizeGuildIdList, type GuildIdInput } from '../lib/guildIds.js';

export interface ModerationActor {
    readonly userId: string;
    readonly tag?: string;
}

export interface PerGuildModerationResult {
    readonly guildId: string;
    readonly ok: boolean;
    readonly code?: DiscordActionCode;
    readonly vars?: Record<string, string | number | boolean | null | undefined>;
    readonly detail?: string;
}

export interface ModerationBatchResult {
    readonly ok: boolean;
    readonly results: readonly PerGuildModerationResult[];
    readonly code?: DiscordActionCode;
    readonly vars?: Record<string, string | number | boolean | null | undefined>;
}

export interface BanOptions {
    readonly guilds: GuildIdInput;
    readonly userId: string;
    readonly actor: ModerationActor;
    readonly reason?: string;
    readonly deleteMessageSeconds?: number;
}

export interface KickOptions {
    readonly guilds: GuildIdInput;
    readonly userId: string;
    readonly actor: ModerationActor;
    readonly reason?: string;
}

export interface TimeoutOptions {
    readonly guilds: GuildIdInput;
    readonly userId: string;
    readonly actor: ModerationActor;
    readonly durationMs: number;
    readonly reason?: string;
}

export interface UntimeoutOptions {
    readonly guilds: GuildIdInput;
    readonly userId: string;
    readonly actor: ModerationActor;
    readonly reason?: string;
}

export interface RoleOptions {
    readonly guilds: GuildIdInput;
    readonly userId: string;
    readonly roleId: string;
    readonly actor: ModerationActor;
    readonly reason?: string;
}

export interface NickOptions {
    readonly guilds: GuildIdInput;
    readonly userId: string;
    readonly actor: ModerationActor;
    readonly nick: string | null;
    readonly reason?: string;
}

function requiredBotPerms(action: PunishAction): bigint[] {
    switch (action) {
        case 'ban':
        case 'unban':
            return [PermissionFlagsBits.BanMembers];
        case 'kick':
            return [PermissionFlagsBits.KickMembers];
        case 'timeout':
        case 'untimeout':
            return [PermissionFlagsBits.ModerateMembers];
        case 'role_add':
        case 'role_remove':
            return [PermissionFlagsBits.ManageRoles];
        case 'nick_set':
        case 'nick_revert':
            return [PermissionFlagsBits.ManageNicknames];
        default:
            return [];
    }
}

function formatModerationReason(actor: ModerationActor, reason?: string): string {
    const who =
        actor.tag && actor.tag.length > 0
            ? `${actor.tag} (${actor.userId})`
            : actor.userId;
    const base = `By ${who}`;
    const full = reason && reason.trim().length > 0 ? `${base}: ${reason.trim()}` : base;
    return full.slice(0, 512);
}

export default class ModerationHandler extends BaseHandler {
    public readonly name = 'moderation';
    public readonly version = '1.0.0';
    public readonly description =
        'Cross-mode guild moderation (ban/kick/timeout/role/nick) for normal, sharded, and Cross-Host workers.';

    public async onInitialize(): Promise<void> {
        this.log.info('Moderation handler ready.');
        if (this.heart.crossHost.isAvailable()) {
            this.heart.crossHost.on('zene:moderation', async (payload) => {
                return this.executeBusPayload(payload);
            });
        }
    }

    private busLocalOnly = false;

    private async executeBusPayload(payload: unknown): Promise<ModerationBatchResult> {
        this.busLocalOnly = true;
        try {
            return await this.executeBusPayloadInner(payload);
        } finally {
            this.busLocalOnly = false;
        }
    }

    private async executeBusPayloadInner(payload: unknown): Promise<ModerationBatchResult> {
        if (!payload || typeof payload !== 'object') {
            return { ok: false, results: [], code: 'invalid_target' };
        }
        const p = payload as {
            op?: string;
            guilds?: GuildIdInput;
            userId?: string;
            actor?: ModerationActor;
            reason?: string;
            roleId?: string;
            nick?: string | null;
            durationMs?: number;
            deleteMessageSeconds?: number;
        };
        if (!p.op || !p.guilds || !p.userId || !p.actor) {
            return { ok: false, results: [], code: 'invalid_target' };
        }
        switch (p.op) {
            case 'ban':
                return this.ban({
                    guilds: p.guilds,
                    userId: p.userId,
                    actor: p.actor,
                    reason: p.reason,
                    deleteMessageSeconds: p.deleteMessageSeconds,
                });
            case 'unban':
                return this.unban({
                    guilds: p.guilds,
                    userId: p.userId,
                    actor: p.actor,
                    reason: p.reason,
                });
            case 'kick':
                return this.kick({
                    guilds: p.guilds,
                    userId: p.userId,
                    actor: p.actor,
                    reason: p.reason,
                });
            case 'timeout':
                return this.timeout({
                    guilds: p.guilds,
                    userId: p.userId,
                    actor: p.actor,
                    durationMs: p.durationMs ?? 0,
                    reason: p.reason,
                });
            case 'untimeout':
                return this.untimeout({
                    guilds: p.guilds,
                    userId: p.userId,
                    actor: p.actor,
                    reason: p.reason,
                });
            case 'role_add':
                return this.addRole({
                    guilds: p.guilds,
                    userId: p.userId,
                    roleId: p.roleId ?? '',
                    actor: p.actor,
                    reason: p.reason,
                });
            case 'role_remove':
                return this.removeRole({
                    guilds: p.guilds,
                    userId: p.userId,
                    roleId: p.roleId ?? '',
                    actor: p.actor,
                    reason: p.reason,
                });
            case 'nick_set':
                return this.setNick({
                    guilds: p.guilds,
                    userId: p.userId,
                    actor: p.actor,
                    nick: p.nick ?? null,
                    reason: p.reason,
                });
            default:
                return { ok: false, results: [], code: 'not_available_here' };
        }
    }

    public async onTeardown(): Promise<void> {
        this.log.info('Moderation handler torn down.');
    }

    private client(): Client {
        return this.heart.client;
    }

    private resolveGuildIds(input: GuildIdInput): { ids: string[]; all: boolean } {
        return normalizeGuildIdList(input);
    }

    private expandGuilds(input: GuildIdInput): Guild[] {
        const { all, ids } = this.resolveGuildIds(input);
        const client = this.client();
        if (all) {
            return Array.from(client.guilds.cache.values());
        }
        const out: Guild[] = [];
        for (const id of ids) {
            const g = client.guilds.cache.get(id);
            if (g) out.push(g);
        }
        return out;
    }

    private async fanOutRemote(
        action: PunishAction,
        guildIds: string[],
        actor: ModerationActor,
        targetUserId: string,
        extra: Record<string, unknown>,
    ): Promise<PerGuildModerationResult[]> {
        if (!this.heart.crossHost.isAvailable() || guildIds.length === 0) {
            return guildIds.map((guildId) => ({
                guildId,
                ok: false,
                code: 'not_in_guild' as const,
            }));
        }
        const self = this.heart.crossHost.machineId();
        const byMachine = new Map<string, string[]>();
        try {
            const { fetchGuildOwner, isClusterClientReady } = await import(
                '#core/crosshost/worker/clusterClient.js'
            );
            if (!isClusterClientReady()) {
                return guildIds.map((guildId) => ({
                    guildId,
                    ok: false,
                    code: 'fleet_unreachable' as const,
                }));
            }
            for (const guildId of guildIds) {
                const info = await fetchGuildOwner(guildId);
                const mid = info.machineId;
                if (!mid || mid === self) {
                    byMachine.set('__local_missing__', [
                        ...(byMachine.get('__local_missing__') ?? []),
                        guildId,
                    ]);
                    continue;
                }
                byMachine.set(mid, [...(byMachine.get(mid) ?? []), guildId]);
            }
        } catch {
            return guildIds.map((guildId) => ({
                guildId,
                ok: false,
                code: 'fleet_unreachable' as const,
            }));
        }

        const results: PerGuildModerationResult[] = [];
        const localMissing = byMachine.get('__local_missing__') ?? [];
        byMachine.delete('__local_missing__');
        for (const gid of localMissing) {
            results.push({ guildId: gid, ok: false, code: 'not_in_guild' });
        }

        for (const [machineId, gids] of byMachine) {
            try {
                const raw = await this.heart.crossHost.request(
                    machineId,
                    'zene:moderation',
                    {
                        op: action,
                        guilds: gids,
                        userId: targetUserId,
                        actor,
                        ...extra,
                    },
                    30_000,
                );
                const batch = raw as ModerationBatchResult;
                if (batch?.results) {
                    results.push(...batch.results);
                } else {
                    for (const gid of gids) {
                        results.push({ guildId: gid, ok: false, code: 'action_failed' });
                    }
                }
            } catch {
                for (const gid of gids) {
                    results.push({ guildId: gid, ok: false, code: 'fleet_unreachable' });
                }
            }
        }
        return results;
    }

    private missingGuildResults(input: GuildIdInput, found: Guild[]): PerGuildModerationResult[] {

        const { all, ids } = this.resolveGuildIds(input);
        if (all) return [];
        const foundIds = new Set(found.map((g) => g.id));
        return ids
            .filter((id) => !foundIds.has(id))
            .map((guildId) => ({
                guildId,
                ok: false,
                code: 'not_in_guild' as const,
            }));
    }

    private botHasPerms(me: GuildMember, action: PunishAction): boolean {
        const need = requiredBotPerms(action);
        if (need.length === 0) return true;
        return need.every((p) => me.permissions.has(p));
    }

    private async runPerGuild(
        action: PunishAction,
        input: GuildIdInput,
        actor: ModerationActor,
        targetUserId: string,
        targetIsBotHint: boolean | null,
        exec: (guild: Guild, me: GuildMember, target: GuildMember | null) => Promise<void>,
        localOnly = false,
    ): Promise<ModerationBatchResult> {
        localOnly = localOnly || this.busLocalOnly;
        const guilds = this.expandGuilds(input);
        const { all, ids } = this.resolveGuildIds(input);
        const foundIds = new Set(guilds.map((g) => g.id));
        const remoteIds = all ? [] : ids.filter((id) => !foundIds.has(id));
        const results: PerGuildModerationResult[] = [];

        if (!localOnly && remoteIds.length > 0) {
            const remote = await this.fanOutRemote(action, remoteIds, actor, targetUserId, {});
            results.push(...remote);
        } else if (localOnly && remoteIds.length > 0) {
            for (const id of remoteIds) {
                results.push({ guildId: id, ok: false, code: 'not_in_guild' });
            }
        }

        if (!localOnly && all && this.heart.crossHost.isAvailable()) {
            const self = this.heart.crossHost.machineId();
            for (const peer of this.heart.crossHost.peers()) {
                if (peer === self) continue;
                try {
                    const raw = await this.heart.crossHost.request(
                        peer,
                        'zene:moderation',
                        {
                            op: action,
                            guilds: 'all',
                            userId: targetUserId,
                            actor,
                        },
                        30_000,
                    );
                    const batch = raw as ModerationBatchResult;
                    if (batch?.results) results.push(...batch.results);
                } catch {
                    results.push({
                        guildId: `peer:${peer}`,
                        ok: false,
                        code: 'fleet_unreachable',
                    });
                }
            }
        }

        if (guilds.length === 0 && results.length === 0) {
            return {
                ok: false,
                results: [],
                code: 'unknown_guild',
            };
        }

        for (const guild of guilds) {
            try {
                const me = guild.members.me ?? (await guild.members.fetchMe());
                if (!this.botHasPerms(me, action)) {
                    results.push({ guildId: guild.id, ok: false, code: 'bot_missing_perms' });
                    continue;
                }

                let target: GuildMember | null = null;
                let targetIsBot = targetIsBotHint === true;
                if (action !== 'unban') {
                    try {
                        target = await guild.members.fetch(targetUserId);
                        targetIsBot = target.user.bot;
                    } catch {
                        if (action === 'ban') {
                            target = null;
                        } else {
                            results.push({ guildId: guild.id, ok: false, code: 'unknown_member' });
                            continue;
                        }
                    }
                }

                const classified = await classifyPunishmentTarget({
                    action,
                    actorUserId: actor.userId,
                    targetUserId,
                    targetIsBot,
                    guildId: guild.id,
                    me,
                    targetMember: target,
                });
                if (classified) {
                    results.push({
                        guildId: guild.id,
                        ok: false,
                        code: classified.code,
                        vars: classified.vars,
                    });
                    continue;
                }

                await exec(guild, me, target);
                results.push({ guildId: guild.id, ok: true });
            } catch (err: unknown) {
                const c: ClassifiedDiscordAction = classifyDiscordError(err);
                results.push({
                    guildId: guild.id,
                    ok: false,
                    code: c.code,
                    vars: c.vars,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }

        const okCount = results.filter((r) => r.ok).length;
        const failCount = results.length - okCount;
        if (failCount === 0) {
            return { ok: true, results };
        }
        if (okCount === 0) {
            const first = results.find((r) => !r.ok);
            return {
                ok: false,
                results,
                code: first?.code ?? 'action_failed',
                vars: first?.vars,
            };
        }
        return {
            ok: false,
            results,
            code: 'partial_failure',
            vars: { reason: `${okCount} succeeded, ${failCount} failed` },
        };
    }

    public async ban(opts: BanOptions): Promise<ModerationBatchResult> {
        const deleteSeconds = Math.max(
            0,
            Math.min(7 * 24 * 3600, opts.deleteMessageSeconds ?? 0),
        );
        return this.runPerGuild(
            'ban',
            opts.guilds,
            opts.actor,
            opts.userId,
            null,
            async (guild) => {
                await guild.members.ban(opts.userId, {
                    reason: formatModerationReason(opts.actor, opts.reason),
                    deleteMessageSeconds: deleteSeconds,
                });
            },
        );
    }

    public async unban(opts: BanOptions): Promise<ModerationBatchResult> {
        return this.runPerGuild(
            'unban',
            opts.guilds,
            opts.actor,
            opts.userId,
            false,
            async (guild) => {
                await guild.members.unban(opts.userId, formatModerationReason(opts.actor, opts.reason));
            },
        );
    }

    public async kick(opts: KickOptions): Promise<ModerationBatchResult> {
        return this.runPerGuild(
            'kick',
            opts.guilds,
            opts.actor,
            opts.userId,
            null,
            async (_guild, _me, target) => {
                if (!target) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                await target.kick(formatModerationReason(opts.actor, opts.reason));
            },
        );
    }

    public async timeout(opts: TimeoutOptions): Promise<ModerationBatchResult> {
        if (!Number.isFinite(opts.durationMs) || opts.durationMs <= 0) {
            return {
                ok: false,
                results: [],
                code: 'invalid_duration',
            };
        }
        return this.runPerGuild(
            'timeout',
            opts.guilds,
            opts.actor,
            opts.userId,
            null,
            async (_guild, _me, target) => {
                if (!target) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                await target.timeout(opts.durationMs, formatModerationReason(opts.actor, opts.reason));
            },
        );
    }

    public async untimeout(opts: UntimeoutOptions): Promise<ModerationBatchResult> {
        return this.runPerGuild(
            'untimeout',
            opts.guilds,
            opts.actor,
            opts.userId,
            null,
            async (_guild, _me, target) => {
                if (!target) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                await target.timeout(null, formatModerationReason(opts.actor, opts.reason));
            },
        );
    }

    public async addRole(opts: RoleOptions): Promise<ModerationBatchResult> {
        return this.runPerGuild(
            'role_add',
            opts.guilds,
            opts.actor,
            opts.userId,
            null,
            async (guild, _me, target) => {
                if (!target) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                const role = guild.roles.cache.get(opts.roleId) ?? (await guild.roles.fetch(opts.roleId).catch(() => null));
                if (!role) {
                    throw Object.assign(new Error('Unknown Role'), { code: 10011 });
                }
                await target.roles.add(role, formatModerationReason(opts.actor, opts.reason));
            },
        );
    }

    public async removeRole(opts: RoleOptions): Promise<ModerationBatchResult> {
        return this.runPerGuild(
            'role_remove',
            opts.guilds,
            opts.actor,
            opts.userId,
            null,
            async (guild, _me, target) => {
                if (!target) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                const role = guild.roles.cache.get(opts.roleId) ?? (await guild.roles.fetch(opts.roleId).catch(() => null));
                if (!role) {
                    throw Object.assign(new Error('Unknown Role'), { code: 10011 });
                }
                await target.roles.remove(role, formatModerationReason(opts.actor, opts.reason));
            },
        );
    }

    public async setNick(opts: NickOptions): Promise<ModerationBatchResult> {
        return this.runPerGuild(
            opts.nick === null || opts.nick === '' ? 'nick_revert' : 'nick_set',
            opts.guilds,
            opts.actor,
            opts.userId,
            null,
            async (_guild, _me, target) => {
                if (!target) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                await target.setNickname(opts.nick && opts.nick.length > 0 ? opts.nick : null, formatModerationReason(opts.actor, opts.reason));
            },
        );
    }

    public async revertNick(opts: Omit<NickOptions, 'nick'>): Promise<ModerationBatchResult> {
        return this.setNick({ ...opts, nick: null });
    }
}
