import type { TextChannel } from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import { normalizeGuildIdList, type GuildIdInput } from '../lib/guildIds.js';

export interface AnnounceResult {
    readonly guildId: string;
    readonly channelId: string | null;
    readonly ok: boolean;
    readonly detail?: string;
}

export default class AnnounceHandler extends BaseHandler {
    public readonly name = 'announce';
    public readonly description = 'Send a message to system/public channels across guilds';

    public async toChannel(
        channelId: string,
        content: string,
    ): Promise<{ ok: boolean; detail?: string }> {
        const ch = this.heart.client.channels.cache.get(channelId);
        if (!ch || !ch.isTextBased() || ch.isDMBased()) {
            return { ok: false, detail: 'invalid_channel' };
        }
        try {
            await (ch as TextChannel).send({ content: content.slice(0, 2000) });
            return { ok: true };
        } catch (err: unknown) {
            return { ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
    }

    public async toGuilds(
        guilds: GuildIdInput,
        content: string,
        channelId?: string,
    ): Promise<AnnounceResult[]> {
        const { all, ids } = normalizeGuildIdList(guilds);
        const client = this.heart.client;
        const guildIds = all ? [...client.guilds.cache.keys()] : ids;
        const results: AnnounceResult[] = [];
        for (const guildId of guildIds) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                results.push({ guildId, channelId: null, ok: false, detail: 'guild_missing' });
                continue;
            }
            let targetId = channelId;
            if (!targetId) {
                const sys = guild.systemChannelId;
                targetId = sys ?? guild.channels.cache.find((c) => c.isTextBased() && !c.isDMBased())?.id;
            }
            if (!targetId) {
                results.push({ guildId, channelId: null, ok: false, detail: 'no_channel' });
                continue;
            }
            const sent = await this.toChannel(targetId, content);
            results.push({
                guildId,
                channelId: targetId,
                ok: sent.ok,
                detail: sent.detail,
            });
        }
        return results;
    }
}
