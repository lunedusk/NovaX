import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';
import type { CrossHostEnv, DesiredState, UpdateAckMessage, UpdateInstructMessage } from '../types.js';
import { channelUpdateInstruct, channelUpdateAck } from '../protocol/channels.js';
import { encodeMessage, decodeMessage } from '../protocol/codec.js';
import { updateAckSchema } from '../protocol/messages.js';
import type { MembershipRegistry } from './membership.js';
import type { ShardMap } from './shardMap.js';
import type { IdentifyQueue } from './identifyQueue.js';

const log = getLogger('CrossHost:UpdateController');

export class UpdateController {
    private readonly env: CrossHostEnv;
    private readonly membership: MembershipRegistry;
    private readonly shardMap: ShardMap;
    private readonly identifyQueue: IdentifyQueue;
    private readonly pub: Redis;
    private readonly sub: Redis;
    private readonly channelPrefix: string;
    private readonly updating: Set<string>;
    private readonly pending = new Map<
        string,
        {
            machineId: string;
            resolve: (ack: UpdateAckMessage) => void;
            timer: NodeJS.Timeout;
        }
    >();

    constructor(opts: {
        env: CrossHostEnv;
        membership: MembershipRegistry;
        shardMap: ShardMap;
        identifyQueue: IdentifyQueue;
        pub: Redis;
        sub: Redis;
        channelPrefix: string;
        updating: Set<string>;
    }) {
        this.env = opts.env;
        this.membership = opts.membership;
        this.shardMap = opts.shardMap;
        this.identifyQueue = opts.identifyQueue;
        this.pub = opts.pub;
        this.sub = opts.sub;
        this.channelPrefix = opts.channelPrefix;
        this.updating = opts.updating;
    }

    public async start(): Promise<void> {
        await this.sub.subscribe(channelUpdateAck(this.channelPrefix));
        this.sub.on('message', (channel, payload) => {
            if (channel !== channelUpdateAck(this.channelPrefix)) return;
            try {
                const raw = decodeMessage(Buffer.from(payload, 'base64'));
                const parsed = updateAckSchema.safeParse(raw);
                if (!parsed.success) return;
                const ack = parsed.data as UpdateAckMessage;
                const pending = this.pending.get(ack.instructId);
                if (!pending) return;
                clearTimeout(pending.timer);
                this.pending.delete(ack.instructId);
                pending.resolve(ack);
            } catch (err) {
                log.warn('Update ack handling error', err);
            }
        });
    }

    private workerNeedsUpdate(machineId: string, desired: DesiredState): boolean {
        const w = this.membership.listWorkers().find((x) => x.machineId === machineId);
        if (!w) return false;
        if (w.zeneVersion !== desired.zeneVersion) return true;
        const want = new Set(desired.plugins.map((p) => `${p.id}@${p.version}`));
        const got = new Set(w.plugins.map((p) => `${p.id}@${p.version}`));
        if (want.size !== got.size) return true;
        for (const k of want) {
            if (!got.has(k)) return true;
        }
        return false;
    }

    public async tick(): Promise<void> {
        const desired = this.membership.getDesiredState();
        const candidates = this.membership
            .listWorkers()
            .filter((w) => !this.updating.has(w.machineId))
            .filter((w) => this.workerNeedsUpdate(w.machineId, desired));

        const slots = this.env.maxConcurrentUpdates - this.updating.size;
        if (slots <= 0 || candidates.length === 0) return;

        const selected = candidates.slice(0, slots);
        for (const worker of selected) {
            void this.runOne(worker.machineId, desired);
        }
    }

    private async runOne(machineId: string, desired: DesiredState): Promise<void> {
        this.updating.add(machineId);
        log.info('Drain-first update starting', { machineId });
        try {
            await this.shardMap.assign(machineId, [], 'drain', this.identifyQueue);
            this.membership.setWorkerShards(machineId, []);

            const drained = await this.waitUntilDrained(machineId, 120_000);
            if (!drained) {
                log.error('Drain timeout; aborting update for worker', { machineId });
                this.updating.delete(machineId);
                return;
            }

            const instructId = randomBytes(12).toString('hex');
            const instruct: UpdateInstructMessage = {
                machineId,
                generation: this.shardMap.getGeneration(),
                desiredState: desired,
                instructId,
            };
            await this.pub.publish(
                channelUpdateInstruct(this.channelPrefix),
                encodeMessage(instruct).toString('base64'),
            );
            log.info('UpdateInstruct sent', { machineId, instructId });

            const ack = await this.waitAck(instructId, machineId, 600_000);
            if (!ack.ok) {
                log.error('Worker update failed', { machineId, message: ack.message });
            } else {
                log.info('Worker acknowledged update path', { machineId, message: ack.message });
            }
        } catch (err) {
            log.error('Update pipeline error', { machineId, err });
        } finally {
            this.updating.delete(machineId);
        }
    }

    private waitUntilDrained(machineId: string, timeoutMs: number): Promise<boolean> {
        const start = Date.now();
        return new Promise((resolve) => {
            const check = () => {
                const shards = this.shardMap.shardsFor(machineId);
                const w = this.membership.listWorkers().find((x) => x.machineId === machineId);
                if (shards.length === 0 && (w === undefined || w.shards.length === 0)) {
                    resolve(true);
                    return;
                }
                if (Date.now() - start > timeoutMs) {
                    resolve(false);
                    return;
                }
                setTimeout(check, 1000).unref();
            };
            check();
        });
    }

    private waitAck(
        instructId: string,
        machineId: string,
        timeoutMs: number,
    ): Promise<UpdateAckMessage> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(instructId);
                resolve({
                    machineId,
                    instructId,
                    ok: false,
                    message: 'ack timeout',
                    at: Date.now(),
                });
            }, timeoutMs);
            timer.unref();
            this.pending.set(instructId, {
                machineId,
                resolve,
                timer,
            });
        });
    }
}
