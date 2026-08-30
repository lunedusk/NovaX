export function shardIdForGuild(guildId: string, totalShards: number): number {
    if (!Number.isInteger(totalShards) || totalShards <= 0) {
        throw new Error(`Invalid totalShards: ${totalShards}`);
    }
    const id = guildId.trim();
    if (!/^\d{5,30}$/.test(id)) {
        throw new Error(`Invalid guildId: ${guildId}`);
    }
    return Number((BigInt(id) >> 22n) % BigInt(totalShards));
}

export type AffinityClass = 'guild' | 'any';

export function extractGuildId(input: {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, unknown>;
}): string | null {
    const fromHeader = input.headers?.['x-novax-guild-id'] ?? input.headers?.['X-NovaX-Guild-Id'];
    if (typeof fromHeader === 'string' && /^\d{5,30}$/.test(fromHeader.trim())) {
        return fromHeader.trim();
    }

    const tryVal = (v: unknown): string | null => {
        if (typeof v === 'string' && /^\d{5,30}$/.test(v.trim())) return v.trim();
        if (typeof v === 'number' && Number.isFinite(v)) {
            const s = String(Math.trunc(v));
            if (/^\d{5,30}$/.test(s)) return s;
        }
        return null;
    };

    const q = input.query ?? {};
    for (const key of ['guildId', 'guild_id', 'serverId', 'server_id']) {
        const hit = tryVal(q[key]);
        if (hit) return hit;
    }

    const p = input.params ?? {};
    for (const key of ['guildId', 'guild_id', 'serverId', 'server_id']) {
        const hit = tryVal(p[key]);
        if (hit) return hit;
    }

    const body = input.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        const rec = body as Record<string, unknown>;
        for (const key of ['guildId', 'guild_id', 'serverId', 'server_id']) {
            const hit = tryVal(rec[key]);
            if (hit) return hit;
        }
    }

    return null;
}

export function classifyAffinity(guildId: string | null): AffinityClass {
    return guildId ? 'guild' : 'any';
}
