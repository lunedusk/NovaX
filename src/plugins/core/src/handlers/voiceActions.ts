import { BaseHandler } from '#core/bases/Handler.js';

export interface VoiceResult {
    readonly ok: boolean;
    readonly detail?: string;
}

export default class VoiceActionsHandler extends BaseHandler {
    public readonly name = 'voiceActions';
    public readonly description = 'Voice move, disconnect, server mute/deafen';

    public async disconnect(guildId: string, userId: string, reason?: string): Promise<VoiceResult> {
        const guild = this.heart.client.guilds.cache.get(guildId);
        if (!guild) return { ok: false, detail: 'guild_missing' };
        try {
            const member = await guild.members.fetch(userId);
            if (!member.voice.channelId) return { ok: false, detail: 'not_in_voice' };
            await member.voice.disconnect(reason);
            return { ok: true };
        } catch (err: unknown) {
            return { ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
    }

    public async move(
        guildId: string,
        userId: string,
        channelId: string,
        reason?: string,
    ): Promise<VoiceResult> {
        const guild = this.heart.client.guilds.cache.get(guildId);
        if (!guild) return { ok: false, detail: 'guild_missing' };
        try {
            const member = await guild.members.fetch(userId);
            await member.voice.setChannel(channelId, reason);
            return { ok: true };
        } catch (err: unknown) {
            return { ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
    }

    public async setMute(
        guildId: string,
        userId: string,
        mute: boolean,
        reason?: string,
    ): Promise<VoiceResult> {
        const guild = this.heart.client.guilds.cache.get(guildId);
        if (!guild) return { ok: false, detail: 'guild_missing' };
        try {
            const member = await guild.members.fetch(userId);
            await member.voice.setMute(mute, reason);
            return { ok: true };
        } catch (err: unknown) {
            return { ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
    }

    public async setDeafen(
        guildId: string,
        userId: string,
        deaf: boolean,
        reason?: string,
    ): Promise<VoiceResult> {
        const guild = this.heart.client.guilds.cache.get(guildId);
        if (!guild) return { ok: false, detail: 'guild_missing' };
        try {
            const member = await guild.members.fetch(userId);
            await member.voice.setDeaf(deaf, reason);
            return { ok: true };
        } catch (err: unknown) {
            return { ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
    }
}
