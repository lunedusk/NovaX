export type GuildIdInput = string | number | ReadonlyArray<string | number>;

export function normalizeGuildIdList(input: GuildIdInput): {
    all: boolean;
    ids: string[];
} {
    const raw = Array.isArray(input) ? [...input] : [input];
    const ids: string[] = [];
    let all = false;
    for (const item of raw) {
        const s = String(item).trim();
        if (!s) continue;
        if (s.toLowerCase() === 'all') {
            all = true;
            continue;
        }
        if (/^\d{5,32}$/.test(s)) {
            ids.push(s);
        }
    }
    return { all, ids: Array.from(new Set(ids)) };
}
