import { getLogger } from '#core/utils/logger.js';
import type { IdentifyGrantMessage } from '../types.js';

const log = getLogger('CrossHost:IdentifyClient');

export class IdentifyGrantWaiter {
    private readonly pending = new Map<
        number,
        {
            resolve: (grant: IdentifyGrantMessage) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();

    public waitFor(shardId: number, timeoutMs: number): Promise<IdentifyGrantMessage> {
        const existing = this.pending.get(shardId);
        if (existing) {
            existing.reject(new Error(`Superseded wait for shard ${shardId}`));
            clearTimeout(existing.timer);
            this.pending.delete(shardId);
        }
        return new Promise<IdentifyGrantMessage>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(shardId);
                log.warn('Identify grant wait timed out', { shardId, timeoutMs });
                reject(new Error(`Identify grant timeout for shard ${shardId}`));
            }, timeoutMs);
            timer.unref();
            this.pending.set(shardId, { resolve, reject, timer });
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
            log.debug('Identify grant with no waiter', {
                shardId: grant.shardId,
                grantId: grant.grantId,
            });
            return;
        }
        clearTimeout(waiter.timer);
        this.pending.delete(grant.shardId);
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
            waiter.reject(new Error(`Identify wait cancelled for shard ${shardId}`));
        }
        this.pending.clear();
    }
}
