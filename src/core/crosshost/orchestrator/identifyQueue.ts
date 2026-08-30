import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';
import type { IdentifyGrantMessage } from '../types.js';
import { channelIdentifyGrant } from '../protocol/channels.js';
import { encodeMessage } from '../protocol/codec.js';

const log = getLogger('CrossHost:IdentifyQueue');

const GRANT_TTL_MS = 30_000;

export class IdentifyQueue {
    private maxConcurrency: number;
    private readonly pub: Redis;
    private readonly channelPrefix: string;
    private readonly bucketNextAt: number[];

    constructor(maxConcurrency: number, pub: Redis, channelPrefix: string) {
        this.maxConcurrency = Math.max(1, maxConcurrency);
        this.pub = pub;
        this.channelPrefix = channelPrefix;
        this.bucketNextAt = Array.from({ length: this.maxConcurrency }, () => 0);
    }

    public setMaxConcurrency(n: number): void {
        this.maxConcurrency = Math.max(1, n);
        while (this.bucketNextAt.length < this.maxConcurrency) {
            this.bucketNextAt.push(0);
        }
    }

    public getMaxConcurrency(): number {
        return this.maxConcurrency;
    }

    public async grant(
        machineId: string,
        shardId: number,
        allowResume: boolean,
    ): Promise<IdentifyGrantMessage> {
        const bucket = shardId % this.maxConcurrency;
        const now = Date.now();
        const readyAt = this.bucketNextAt[bucket] ?? 0;
        if (readyAt > now) {
            const wait = readyAt - now;
            log.debug('Identify bucket wait', { shardId, bucket, waitMs: wait });
            await new Promise<void>((resolve) => {
                setTimeout(resolve, wait).unref();
            });
        }
        this.bucketNextAt[bucket] = Date.now() + 5_500;

        const message: IdentifyGrantMessage = {
            machineId,
            shardId,
            grantId: randomBytes(12).toString('hex'),
            expiresAt: Date.now() + GRANT_TTL_MS,
            allowResume,
        };

        await this.pub.publish(
            channelIdentifyGrant(this.channelPrefix),
            encodeMessage(message).toString('base64'),
        );

        log.info('Identify grant issued', {
            machineId,
            shardId,
            grantId: message.grantId,
            bucket,
            allowResume,
            expiresAt: message.expiresAt,
        });

        return message;
    }

    public async grantMany(
        machineId: string,
        shardIds: readonly number[],
        allowResume: boolean,
    ): Promise<IdentifyGrantMessage[]> {
        const out: IdentifyGrantMessage[] = [];
        for (const shardId of [...shardIds].sort((a, b) => a - b)) {
            out.push(await this.grant(machineId, shardId, allowResume));
        }
        return out;
    }
}
