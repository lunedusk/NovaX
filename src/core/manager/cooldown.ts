import { CooldownBucket, type CooldownContext, type CooldownResult } from './cooldown/Bucket.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CooldownManager');

export interface BucketDefinition {
    slug: string;
    limit: number;
    windowSeconds: number;
}

export class CooldownManager {
    private readonly buckets = new Map<string, CooldownBucket>();
    
    public initialize(definitions: BucketDefinition[]): void {
        for (const def of definitions) {
            this.define(def.slug, def.limit, def.windowSeconds);
        }
        log.info(`Initialized ${definitions.length} cooldown buckets.`);
    }

    public define(slug: string, limit: number, windowSeconds: number): void {
        if (this.buckets.has(slug)) {
            log.warn(`Redefining existing cooldown bucket: [${slug}]`);
        }
        
        this.buckets.set(slug, new CooldownBucket(slug, limit, windowSeconds * 1000));
        log.debug(`Bucket Defined: [${slug}] -> ${limit} req / ${windowSeconds}s`);
    }

    public async isRateLimited(
        slug: string, 
        ctx: CooldownContext, 
        customLimit?: number, 
        customWindowMs?: number
    ): Promise<CooldownResult> {
        let bucket = this.buckets.get(slug);
        
        if (!bucket) {
            const limit = customLimit ?? 1;
            const windowSeconds = customWindowMs ? customWindowMs / 1000 : 5;

            log.info(`Auto-provisioning dynamic bucket [${slug}] -> ${limit} req / ${windowSeconds}s`);
            
            this.define(slug, limit, windowSeconds);
            bucket = this.buckets.get(slug)!;
        }

        try {
            return await bucket.check(ctx);
        } catch (error) {
            log.error(`Internal Cooldown Error [${slug}]: ${(error as Error).message}`);
            return { limited: false, remaining: 0 };
        }
    }

    public async refund(slug: string, ctx: CooldownContext): Promise<void> {
        try {
            const bucket = this.buckets.get(slug);
            if (bucket) {
                await bucket.refund(ctx);
            }
        } catch (error) {
            log.warn(`Failed to refund cooldown for [${slug}]: ${(error as Error).message}`);
        }
    }

    public getBucket(slug: string): CooldownBucket | undefined {
        return this.buckets.get(slug);
    }

    public flush(): void {
        this.buckets.clear();
        log.info('All cooldown buckets have been flushed.');
    }
}

export const cooldownManager = new CooldownManager();