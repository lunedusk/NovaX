import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CrossHost:PeerRoster');

export function rosterKey(prefix: string): string {
    return `${prefix}:peers`;
}

export class PeerRosterPublisher {
    private readonly redis: Redis;
    private readonly prefix: string;
    private readonly ttlSec: number;

    constructor(redis: Redis, prefix: string, ttlSec = 30) {
        this.redis = redis;
        this.prefix = prefix;
        this.ttlSec = ttlSec;
    }

    public async publish(machineIds: readonly string[]): Promise<void> {
        const key = rosterKey(this.prefix);
        const pipe = this.redis.multi();
        pipe.del(key);
        if (machineIds.length > 0) {
            pipe.sadd(key, ...machineIds);
            pipe.expire(key, this.ttlSec);
        }
        await pipe.exec();
        log.debug('Peer roster published', { count: machineIds.length });
    }

    public async add(machineId: string): Promise<void> {
        const key = rosterKey(this.prefix);
        await this.redis.sadd(key, machineId);
        await this.redis.expire(key, this.ttlSec);
    }

    public async remove(machineId: string): Promise<void> {
        await this.redis.srem(rosterKey(this.prefix), machineId);
    }
}

export async function fetchPeerRoster(redis: Redis, prefix: string): Promise<string[]> {
    const members = await redis.smembers(rosterKey(prefix));
    return members.sort();
}
