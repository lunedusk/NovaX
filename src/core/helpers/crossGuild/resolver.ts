import {
    type Client,
    type Guild,
    type GuildMember,
    PermissionsBitField,
    type PermissionResolvable
} from 'discord.js';
import { TTLCache } from '#core/helpers/cache.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CrossGuildResolver');

export interface EligibleGuild {
    guild: Guild;
    member: GuildMember;
    botMember: GuildMember;
}

export interface EligibilityFilter {
    userPermissions?: PermissionResolvable[];
    clientPermissions?: PermissionResolvable[];
    roleIds?: string[];
}

const eligibilityCache = new TTLCache<string, EligibleGuild[]>({
    name: 'cross-guild.eligibility',
    defaultTTL: 120_000,
    maxSize: 512,
    cleanupInterval: 60_000
});

function buildCacheKey(userId: string, filter: EligibilityFilter): string {
    const perms = (filter.userPermissions ?? []).map(String).sort().join(',');
    const client = (filter.clientPermissions ?? []).map(String).sort().join(',');
    const roles = (filter.roleIds ?? []).sort().join(',');
    return `${userId}:${perms}|${client}|${roles}`;
}

export class CrossGuildResolver {
    constructor(private readonly client: Client) {}

    public async getEligibleGuilds(userId: string, filter: EligibilityFilter): Promise<EligibleGuild[]> {
        const cacheKey = buildCacheKey(userId, filter);
        const cached = eligibilityCache.get(cacheKey);

        if (cached) {
            return cached;
        }

        const results: EligibleGuild[] = [];

        const checks = this.client.guilds.cache.map(async (guild) => {
            try {
                const [member, botMember] = await Promise.all([
                    guild.members.fetch(userId).catch(() => null),
                    guild.members.fetchMe().catch(() => null)
                ]);

                if (!member || !botMember) return;

                if (filter.userPermissions?.length) {
                    const required = new PermissionsBitField(filter.userPermissions).bitfield;
                    if (!member.permissions.has(required)) return;
                }

                if (filter.clientPermissions?.length) {
                    const required = new PermissionsBitField(filter.clientPermissions).bitfield;
                    if (!botMember.permissions.has(required)) return;
                }

                if (filter.roleIds?.length) {
                    if (!filter.roleIds.some(id => member.roles.cache.has(id))) return;
                }

                results.push({ guild, member, botMember });
            } catch (err) {
                log.debug(`Skipped guild ${guild.id}: ${err}`);
            }
        });

        await Promise.all(checks);
        eligibilityCache.set(cacheKey, results);
        return results;
    }

    public async hasAnyEligibleGuild(userId: string, filter: EligibilityFilter): Promise<boolean> {
        const eligible = await this.getEligibleGuilds(userId, filter);
        return eligible.length > 0;
    }

    public static clearCache(): void {
        eligibilityCache.clear();
        log.debug('Cross-guild eligibility cache cleared.');
    }

    public static clearUserCache(userId: string): void {
        let cleared = 0;
        for (const [key] of eligibilityCache.entries()) {
            if (key.startsWith(`${userId}:`)) {
                eligibilityCache.delete(key);
                cleared++;
            }
        }
        if (cleared > 0) {
            log.debug(`Cleared ${cleared} cached entries for user ${userId}.`);
        }
    }

    public static get cacheStats() {
        return eligibilityCache.stats;
    }
}
