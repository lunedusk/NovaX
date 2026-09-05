import { BaseHandler } from '#core/bases/Handler.js';

export interface GuildSummary {
    readonly id: string;
    readonly name: string;
    readonly memberCount: number;
    readonly ownerId: string;
    readonly shardId: number;
}

export default class GuildActionsHandler extends BaseHandler {
    public readonly name = 'guildActions';
    public readonly description = 'Guild summary and leave helpers';

    public summarizeLocal(): GuildSummary[] {
        const client = this.heart.client;
        const local = this.heart.control.shards();
        const total = Math.max(1, client.shard?.count ?? (local.length > 0 ? local.length : 1));
        return [...client.guilds.cache.values()].map((g) => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
            ownerId: g.ownerId,
            shardId: Number((BigInt(g.id) >> 22n) % BigInt(total)),
        }));
    }

    public async leave(guildId: string): Promise<boolean> {
        const guild = this.heart.client.guilds.cache.get(guildId);
        if (!guild) return false;
        try {
            await guild.leave();
            return true;
        } catch {
            return false;
        }
    }
}
