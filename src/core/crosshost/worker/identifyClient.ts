import { getLogger } from '#core/utils/logger.js';
import type { IdentifyGrantMessage } from '../types.js';
import type { Redis } from 'ioredis';
import { loadGrantFromRedis } from '../orchestrator/identifyQueue.js';

const log = getLogger('CrossHost:IdentifyClient');

export class IdentifyGrantWaiter {
    private readonly pending = new Map<
        number,
        {
            resolve: (grant: IdentifyGrantMessage) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
            poll: NodeJS.Timeout | null;
        }
    >();
    private readonly buffered = new Map<number, IdentifyGrantMessage>();
    private redisMain: Redis | null = null;
    private channelPrefix = '';
    private machineId = '';

    public configureRedis(main: Redis, channelPrefix: string, machineId: string): void {
        this.redisMain = main;
        this.channelPrefix = channelPrefix;
        this.machineId = machineId;
    }

    public waitFor(shardId: number, timeoutMs: number): Promise<IdentifyGrantMessage> {
        const buffered = this.buffered.get(shardId);
        if (buffered && buffered.expiresAt >= Date.now()) {
            this.buffered.delete(shardId);
            log.info('Identify grant taken from buffer', {
                shardId,
                grantId: buffered.grantId,
            });
            return Promise.resolve(buffered);
        }
        this.buffered.delete(shardId);

        const existing = this.pending.get(shardId);
        if (existing) {
            existing.reject(new Error(`Superseded wait for shard ${shardId}`));
            clearTimeout(existing.timer);
            if (existing.poll) clearInterval(existing.poll);
            this.pending.delete(shardId);
        }

        return new Promise<IdentifyGrantMessage>((resolve, reject) => {
            const timer = setTimeout(() => {
                const entry = this.pending.get(shardId);
                if (entry?.poll) clearInterval(entry.poll);
                this.pending.delete(shardId);
                log.warn('Identify grant wait timed out', { shardId, timeoutMs });
                reject(new Error(`Identify grant timeout for shard ${shardId}`));
            }, timeoutMs);
            timer.unref();

            let poll: NodeJS.Timeout | null = null;
            if (this.redisMain && this.machineId) {
                const main = this.redisMain;
                const prefix = this.channelPrefix;
                const machineId = this.machineId;
                const tick = async () => {
                    try {
                        const grant = await loadGrantFromRedis(main, prefix, machineId, shardId);
                        if (grant) {
                            this.deliver(grant);
                        }
                    } catch {

                    }
                };
                void tick();
                poll = setInterval(() => {
                    void tick();
                }, 500);
                poll.unref();
            }

            this.pending.set(shardId, { resolve, reject, timer, poll });
        });
    }

    public deliver(grant: IdentifyGrantMessage): void {
        if (grant.expiresAt < Date.now()) {
            log.warn('Ignoring expired identify grant', {
                shardId: grant.shardId,
                grantId: grant.grantId,
            });
            return;
        }
        const waiter = this.pending.get(grant.shardId);
        if (!waiter) {
            this.buffered.set(grant.shardId, grant);
            log.debug('Identify grant buffered (no waiter yet)', {
                shardId: grant.shardId,
                grantId: grant.grantId,
            });
            return;
        }
        clearTimeout(waiter.timer);
        if (waiter.poll) clearInterval(waiter.poll);
        this.pending.delete(grant.shardId);
        this.buffered.delete(grant.shardId);
        log.info('Identify grant delivered to waiter', {
            shardId: grant.shardId,
            grantId: grant.grantId,
            allowResume: grant.allowResume,
        });
        waiter.resolve(grant);
    }

    public clear(): void {
        for (const [shardId, waiter] of this.pending.entries()) {
            clearTimeout(waiter.timer);
            if (waiter.poll) clearInterval(waiter.poll);
            waiter.reject(new Error(`Identify wait cancelled for shard ${shardId}`));
        }
        this.pending.clear();
        this.buffered.clear();
    }
}
