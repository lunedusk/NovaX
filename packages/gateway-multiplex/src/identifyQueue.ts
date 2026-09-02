import { IDENTIFY_BUCKET_SPACING_MS } from './constants.js';

export class IdentifyQueue {
    private maxConcurrency: number;
    private readonly lastIdentifyByBucket = new Map<number, number>();
    private queue: Promise<void> = Promise.resolve();

    public constructor(maxConcurrency: number) {
        this.maxConcurrency = Math.max(1, maxConcurrency);
    }

    public setMaxConcurrency(n: number): void {
        this.maxConcurrency = Math.max(1, n);
    }

    public bucketFor(shardId: number): number {
        return shardId % this.maxConcurrency;
    }

    public async waitTurn(shardId: number): Promise<void> {
        const bucket = this.bucketFor(shardId);
        const run = async (): Promise<void> => {
            const last = this.lastIdentifyByBucket.get(bucket) ?? 0;
            const elapsed = Date.now() - last;
            if (elapsed < IDENTIFY_BUCKET_SPACING_MS) {
                await sleep(IDENTIFY_BUCKET_SPACING_MS - elapsed);
            }
            this.lastIdentifyByBucket.set(bucket, Date.now());
        };
        const next = this.queue.then(run, run);
        this.queue = next.then(
            () => undefined,
            () => undefined,
        );
        await next;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        if (typeof t === 'object' && t !== null && 'unref' in t) {
            (t as NodeJS.Timeout).unref();
        }
    });
}
