import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CrossHost:Claim');

const CLAIM_KEY = 'zene:crosshost:orchestrator:claim';
const CLAIM_TTL_SEC = 30;
const RENEW_INTERVAL_MS = 10_000;

export interface ClaimHandle {
    readonly token: string;
    readonly fingerprint: string;
    stop(): Promise<void>;
}

function fingerprintOf(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export async function acquireOrchestratorClaim(redis: Redis): Promise<ClaimHandle> {
    const token = randomBytes(32).toString('hex');
    const fingerprint = fingerprintOf(token);

    const result = await redis.set(CLAIM_KEY, token, 'EX', CLAIM_TTL_SEC, 'NX');
    if (result !== 'OK') {
        const holder = await redis.get(CLAIM_KEY);
        log.error('Orchestrator claim conflict — another process holds the claim', {
            localFingerprint: fingerprint.slice(0, 12),
            holderPresent: holder !== null,
        });
        throw new Error('CLAIM_CONFLICT: another orchestrator already holds the cluster claim');
    }

    log.info('Orchestrator claim acquired', { fingerprint: fingerprint.slice(0, 12) });
        void import('#core/manager/event.js')
            .then(({ eventBus }) => eventBus.emitConcurrent('crosshost.claim.acquired', { fingerprint: fingerprint.slice(0, 12) }))
            .catch(() => undefined);

    let stopped = false;
    const renew = async (): Promise<void> => {
        if (stopped) return;
        try {
            const current = await redis.get(CLAIM_KEY);
            if (current !== token) {
                log.error('Orchestrator claim lost — key no longer matches this process');
                process.exit(1);
            }
            await redis.set(CLAIM_KEY, token, 'EX', CLAIM_TTL_SEC);
        } catch (err) {
            log.error('Orchestrator claim renew failed', err);
        }
    };

    const timer = setInterval(() => {
        void renew();
    }, RENEW_INTERVAL_MS);
    timer.unref();

    return {
        token,
        fingerprint,
        async stop() {
            stopped = true;
            clearInterval(timer);
            try {
                const current = await redis.get(CLAIM_KEY);
                if (current === token) {
                    await redis.del(CLAIM_KEY);
                    log.info('Orchestrator claim released');
                }
            } catch (err) {
                log.warn('Failed to release orchestrator claim cleanly', err);
            }
        },
    };
}
