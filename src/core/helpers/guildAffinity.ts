import type { Client, Guild } from 'discord.js';

export function shardIdForGuild(guildId: string, totalShards: number): number {
    const total = Math.max(1, totalShards);
    return Number((BigInt(guildId) >> 22n) % BigInt(total));
}

export function findGuildOnClient(client: Client, guildId: string): Guild | undefined {
    return client.guilds.cache.get(guildId);
}

export async function ensureGuildOnClient(
    client: Client,
    guildId: string,
): Promise<Guild | null> {
    const cached = client.guilds.cache.get(guildId);
    if (cached) return cached;
    try {
        return await client.guilds.fetch(guildId);
    } catch {
        return null;
    }
}

export function isGuildLikelyOnProcess(
    guildId: string,
    totalShards: number,
    localShards: readonly number[],
): boolean {
    if (localShards.length === 0) return true;
    const sid = shardIdForGuild(guildId, totalShards);
    return localShards.includes(sid);
}
