import type { TextChannel } from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';

export interface PurgeResult {
    readonly channelId: string;
    readonly deleted: number;
    readonly ok: boolean;
    readonly detail?: string;
}

export default class MessageActionsHandler extends BaseHandler {
    public readonly name = 'messageActions';
    public readonly description = 'Purge, pin, unpin messages';

    public async purge(
        channelId: string,
        limit: number,
        filterUserId?: string,
    ): Promise<PurgeResult> {
        const ch = this.heart.client.channels.cache.get(channelId);
        if (!ch || !ch.isTextBased() || ch.isDMBased()) {
            return { channelId, deleted: 0, ok: false, detail: 'invalid_channel' };
        }
        const text = ch as TextChannel;
        const capped = Math.min(100, Math.max(1, limit));
        try {
            const fetched = await text.messages.fetch({ limit: capped });
            const toDelete = filterUserId
                ? fetched.filter((m) => m.author.id === filterUserId)
                : fetched;
            const deleted = await text.bulkDelete(toDelete, true);
            return { channelId, deleted: deleted.size, ok: true };
        } catch (err: unknown) {
            return {
                channelId,
                deleted: 0,
                ok: false,
                detail: err instanceof Error ? err.message : String(err),
            };
        }
    }

    public async pin(channelId: string, messageId: string, reason?: string): Promise<boolean> {
        const ch = this.heart.client.channels.cache.get(channelId);
        if (!ch || !ch.isTextBased()) return false;
        try {
            const msg = await ch.messages.fetch(messageId);
            await msg.pin(reason);
            return true;
        } catch {
            return false;
        }
    }

    public async unpin(channelId: string, messageId: string, reason?: string): Promise<boolean> {
        const ch = this.heart.client.channels.cache.get(channelId);
        if (!ch || !ch.isTextBased()) return false;
        try {
            const msg = await ch.messages.fetch(messageId);
            await msg.unpin(reason);
            return true;
        } catch {
            return false;
        }
    }
}
