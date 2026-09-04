import {
    type GuildChannel,
    type TextChannel,
    ChannelType,
} from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import { normalizeGuildIdList, type GuildIdInput } from '../lib/guildIds.js';

export interface ChannelActionResult {
    readonly guildId: string;
    readonly channelId: string;
    readonly ok: boolean;
    readonly detail?: string;
}

export default class ChannelActionsHandler extends BaseHandler {
    public readonly name = 'channelActions';
    public readonly description = 'Channel lock, unlock, slowmode, rename, topic';

    private async channels(
        guilds: GuildIdInput,
        channelId: string,
    ): Promise<Array<{ guildId: string; channel: GuildChannel }>> {
        const { all, ids } = normalizeGuildIdList(guilds);
        const client = this.heart.client;
        const guildIds = all ? [...client.guilds.cache.keys()] : ids;
        const out: Array<{ guildId: string; channel: GuildChannel }> = [];
        for (const guildId of guildIds) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) continue;
            const ch = guild.channels.cache.get(channelId);
            if (ch && ch.isTextBased()) {
                out.push({ guildId, channel: ch as GuildChannel });
            }
        }
        return out;
    }

    public async setSlowmode(
        guilds: GuildIdInput,
        channelId: string,
        seconds: number,
        reason?: string,
    ): Promise<ChannelActionResult[]> {
        const results: ChannelActionResult[] = [];
        for (const { guildId, channel } of await this.channels(guilds, channelId)) {
            try {
                if (!('setRateLimitPerUser' in channel)) {
                    results.push({ guildId, channelId, ok: false, detail: 'unsupported' });
                    continue;
                }
                await (channel as TextChannel).setRateLimitPerUser(seconds, reason);
                results.push({ guildId, channelId, ok: true });
            } catch (err: unknown) {
                results.push({
                    guildId,
                    channelId,
                    ok: false,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }
        return results;
    }

    public async setName(
        guilds: GuildIdInput,
        channelId: string,
        name: string,
        reason?: string,
    ): Promise<ChannelActionResult[]> {
        const results: ChannelActionResult[] = [];
        for (const { guildId, channel } of await this.channels(guilds, channelId)) {
            try {
                await channel.setName(name, reason);
                results.push({ guildId, channelId, ok: true });
            } catch (err: unknown) {
                results.push({
                    guildId,
                    channelId,
                    ok: false,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }
        return results;
    }

    public async setTopic(
        guilds: GuildIdInput,
        channelId: string,
        topic: string,
        reason?: string,
    ): Promise<ChannelActionResult[]> {
        const results: ChannelActionResult[] = [];
        for (const { guildId, channel } of await this.channels(guilds, channelId)) {
            try {
                if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
                    results.push({ guildId, channelId, ok: false, detail: 'not_text' });
                    continue;
                }
                await (channel as TextChannel).setTopic(topic, reason);
                results.push({ guildId, channelId, ok: true });
            } catch (err: unknown) {
                results.push({
                    guildId,
                    channelId,
                    ok: false,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }
        return results;
    }

    public async lock(
        guilds: GuildIdInput,
        channelId: string,
        reason?: string,
    ): Promise<ChannelActionResult[]> {
        return this.setSendPermission(guilds, channelId, false, reason);
    }

    public async unlock(
        guilds: GuildIdInput,
        channelId: string,
        reason?: string,
    ): Promise<ChannelActionResult[]> {
        return this.setSendPermission(guilds, channelId, true, reason);
    }

    private async setSendPermission(
        guilds: GuildIdInput,
        channelId: string,
        allow: boolean,
        reason?: string,
    ): Promise<ChannelActionResult[]> {
        const results: ChannelActionResult[] = [];
        for (const { guildId, channel } of await this.channels(guilds, channelId)) {
            try {
                const everyone = channel.guild.roles.everyone;
                await channel.permissionOverwrites.edit(
                    everyone,
                    { SendMessages: allow ? null : false },
                    { reason },
                );
                results.push({ guildId, channelId, ok: true });
            } catch (err: unknown) {
                results.push({
                    guildId,
                    channelId,
                    ok: false,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }
        return results;
    }
}
