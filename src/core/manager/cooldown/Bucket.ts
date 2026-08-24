import { cacheFacade } from '#core/manager/cacheFacade.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CooldownBucket');

export interface CooldownContext {
    userId: string;
    commandId: string;
    guildId?: string;
}

export interface CooldownResult {
    limited: boolean;
    remaining: number;
}

export class CooldownBucket {
    private readonly cache = cacheFacade.cooldown();

    constructor(
        public readonly slug: string,
        public readonly limit: number,
        public readonly windowMs: number,
    ) {}

    private buildKey(ctx: CooldownContext): string {
        const guild = ctx.guildId ?? 'dm';
        return `ratelimit:${this.slug}:${guild}:${ctx.userId}:${ctx.commandId}`;
    }

    public async check(ctx: CooldownContext): Promise<CooldownResult> {
        const key = this.buildKey(ctx);
        try {
            const result = await this.cache.incrWithTtl(key, this.windowMs, this.limit);
            if (result.limited) {
                return { limited: true, remaining: result.ttlMs };
            }
            return { limited: false, remaining: 0 };
        } catch (err) {
            log.warn(`Cooldown check failed for bucket [${this.slug}]: ${(err as Error).message}`);
            return { limited: false, remaining: 0 };
        }
    }

    public async refund(ctx: CooldownContext): Promise<void> {
        const key = this.buildKey(ctx);
        try {
            await this.cache.decr(key);
        } catch (err) {
            log.warn(`Failed to refund cooldown for [${key}]: ${(err as Error).message}`);
        }
    }
}
