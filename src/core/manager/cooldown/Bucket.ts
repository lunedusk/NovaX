import { redisDB } from '#core/database/index.js';
import { TTLCache } from '#core/helpers/cache.js';
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

interface LocalRecord {
    count: number;
    resetAt: number;
}

export class CooldownBucket {
    private readonly localFallback: TTLCache<string, LocalRecord>;

    constructor(
        public readonly slug: string,
        public readonly limit: number,
        public readonly windowMs: number
    ) {
        this.localFallback = new TTLCache<string, LocalRecord>({
            maxSize: 10000,
            defaultTTL: windowMs
        });
    }

    private buildKey(ctx: CooldownContext): string {
        const guild = ctx.guildId ?? 'dm';
        return `ratelimit:${this.slug}:${guild}:${ctx.userId}:${ctx.commandId}`;
    }

    private getRedisClient() {
        try {
            return redisDB.get('cooldown')?.main || redisDB.get('redis')?.main || null;
        } catch {
            return null;
        }
    }

    public async check(ctx: CooldownContext): Promise<CooldownResult> {
        const key = this.buildKey(ctx);
        const redis = this.getRedisClient();

        if (redis) {
            try {
                const pipeline = redis.pipeline();
                pipeline.incr(key);
                pipeline.pexpire(key, this.windowMs, 'NX');
                pipeline.pttl(key);
                
                const results = await pipeline.exec();
                if (!results) throw new Error("Pipeline returned empty");

                const currentCount = results[0][1] as number;
                const pttl = results[2][1] as number;
                const ttl = pttl > 0 ? pttl : this.windowMs;

                if (currentCount > this.limit) {
                    return { limited: true, remaining: ttl };
                }

                return { limited: false, remaining: 0 };

            } catch (err) {
                log.warn(`Redis unavailable for bucket [${this.slug}]: ${(err as Error).message}. Shifting to TTLCache.`);
            }
        }

        return this.checkLocal(key);
    }

    public async refund(ctx: CooldownContext): Promise<void> {
        const key = this.buildKey(ctx);
        const redis = this.getRedisClient();

        if (redis) {
            try {
                const current = await redis.get(key);
                if (current && parseInt(current, 10) > 0) {
                    await redis.decr(key);
                }
                return;
            } catch (err) {
                log.warn(`Failed to refund Redis cooldown for [${key}]`);
            }
        }

        const record = this.localFallback.get(key);
        if (record && record.count > 0) {
            record.count -= 1;
            this.localFallback.set(key, record, Math.max(1, record.resetAt - Date.now()));
        }
    }

    private checkLocal(key: string): CooldownResult {
        const now = Date.now();
        let record = this.localFallback.get(key);

        if (!record) {
            record = { count: 1, resetAt: now + this.windowMs };
            this.localFallback.set(key, record, this.windowMs);
            
            return { limited: this.limit < 1, remaining: this.limit < 1 ? this.windowMs : 0 };
        }

        const remainingTime = record.resetAt - now;

        if (remainingTime <= 0) {
            record = { count: 1, resetAt: now + this.windowMs };
            this.localFallback.set(key, record, this.windowMs);
            return { limited: false, remaining: 0 };
        }

        record.count += 1;

        this.localFallback.set(key, record, remainingTime);

        if (record.count > this.limit) {
            return { limited: true, remaining: remainingTime };
        }

        return { limited: false, remaining: 0 };
    }
}