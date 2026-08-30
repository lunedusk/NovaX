import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';
import type { AssignmentReason, AssignmentUpdateMessage } from '../types.js';
import { channelAssignmentUpdate } from '../protocol/channels.js';
import { encodeMessage } from '../protocol/codec.js';
import type { IdentifyQueue } from './identifyQueue.js';

const log = getLogger('CrossHost:ShardMap');

export class ShardMap {
    private generation = 1;
    private totalShards: number;
    private readonly owner = new Map<number, string>();
    private readonly pub: Redis;
    private readonly channelPrefix: string;

    constructor(totalShards: number, pub: Redis, channelPrefix: string) {
        if (!Number.isInteger(totalShards) || totalShards < 1) {
            throw new Error(`Invalid totalShards: ${totalShards}`);
        }
        this.totalShards = totalShards;
        this.pub = pub;
        this.channelPrefix = channelPrefix;
    }

    public getGeneration(): number {
        return this.generation;
    }

    public getTotalShards(): number {
        return this.totalShards;
    }

    public setTotalShards(n: number): void {
        if (!Number.isInteger(n) || n < 1) {
            throw new Error(`Invalid totalShards: ${n}`);
        }
        this.totalShards = n;
    }

    public shardsFor(machineId: string): number[] {
        const out: number[] = [];
        for (const [shardId, owner] of this.owner.entries()) {
            if (owner === machineId) out.push(shardId);
        }
        return out.sort((a, b) => a - b);
    }

    public ownerOf(shardId: number): string | undefined {
        return this.owner.get(shardId);
    }

    public async assign(
        machineId: string,
        shards: readonly number[],
        reason: AssignmentReason,
        identifyQueue?: IdentifyQueue,
    ): Promise<AssignmentUpdateMessage> {
        for (const shardId of shards) {
            if (!Number.isInteger(shardId) || shardId < 0 || shardId >= this.totalShards) {
                throw new Error(`Shard id out of range: ${shardId} (totalShards=${this.totalShards})`);
            }
        }

        const unique = [...new Set(shards)].sort((a, b) => a - b);

        for (const [shardId, owner] of [...this.owner.entries()]) {
            if (owner === machineId && !unique.includes(shardId)) {
                this.owner.delete(shardId);
            }
        }
        for (const shardId of unique) {
            const prev = this.owner.get(shardId);
            if (prev !== undefined && prev !== machineId) {
                log.info('Shard ownership transfer', {
                    shardId,
                    from: prev,
                    to: machineId,
                    reason,
                });
            }
            this.owner.set(shardId, machineId);
        }

        this.generation += 1;
        const message: AssignmentUpdateMessage = {
            generation: this.generation,
            machineId,
            shards: unique,
            totalShards: this.totalShards,
            reason,
        };

        await this.pub.publish(
            channelAssignmentUpdate(this.channelPrefix),
            encodeMessage(message).toString('base64'),
        );

        log.info('Assignment published', {
            generation: this.generation,
            machineId,
            shards: unique,
            reason,
            totalShards: this.totalShards,
        });

        if (identifyQueue && unique.length > 0) {
            await identifyQueue.grantMany(machineId, unique, reason !== 'join');
        }

        return message;
    }

    public async clearMachine(machineId: string, reason: AssignmentReason): Promise<void> {
        const had = this.shardsFor(machineId);
        if (had.length === 0) return;
        for (const shardId of had) {
            this.owner.delete(shardId);
        }
        this.generation += 1;
        const message: AssignmentUpdateMessage = {
            generation: this.generation,
            machineId,
            shards: [],
            totalShards: this.totalShards,
            reason,
        };
        await this.pub.publish(
            channelAssignmentUpdate(this.channelPrefix),
            encodeMessage(message).toString('base64'),
        );
        log.info('Machine shards cleared', {
            generation: this.generation,
            machineId,
            previousShards: had,
            reason,
        });
    }
}
