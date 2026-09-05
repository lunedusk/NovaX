import { BaseHandler } from '#core/bases/Handler.js';

export default class EmojiActionsHandler extends BaseHandler {
    public readonly name = 'emojiActions';
    public readonly description = 'Guild emoji list and framework emoji map access';

    public listGuildEmojis(guildId: string): Array<{ id: string; name: string; animated: boolean }> {
        const guild = this.heart.client.guilds.cache.get(guildId);
        if (!guild) return [];
        return [...guild.emojis.cache.values()].map((e) => ({
            id: e.id,
            name: e.name ?? '',
            animated: e.animated,
        }));
    }

    public frameworkEmoji(key: string): string | undefined {
        try {
            return this.heart.assets.emoji?.get?.(key) as string | undefined;
        } catch {
            return undefined;
        }
    }

    public frameworkAll(): Record<string, string> {
        try {
            return { ...(this.heart.assets.emoji?.getAll?.() ?? {}) };
        } catch {
            return {};
        }
    }
}
