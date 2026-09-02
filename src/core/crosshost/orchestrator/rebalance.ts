import { getLogger } from '#core/utils/logger.js';
import type { CrossHostEnv, WorkerStats } from '../types.js';
import type { MembershipRegistry } from './membership.js';
import type { ShardMap } from './shardMap.js';
import type { IdentifyQueue } from './identifyQueue.js';
import { getStrategy } from './strategies/index.js';
import { computeImbalance, computeLoadScore } from './metrics.js';

const log = getLogger('CrossHost:Rebalance');

export class RebalanceEngine {
    private lastRunAt = 0;
    private readonly env: CrossHostEnv;
    private readonly membership: MembershipRegistry;
    private readonly shardMap: ShardMap;
    private readonly identifyQueue: IdentifyQueue;
    private readonly stats: Map<string, WorkerStats>;
    private readonly updating: Set<string>;

    constructor(opts: {
        env: CrossHostEnv;
        membership: MembershipRegistry;
        shardMap: ShardMap;
        identifyQueue: IdentifyQueue;
        stats: Map<string, WorkerStats>;
        updating: Set<string>;
    }) {
        this.env = opts.env;
        this.membership = opts.membership;
        this.shardMap = opts.shardMap;
        this.identifyQueue = opts.identifyQueue;
        this.stats = opts.stats;
        this.updating = opts.updating;
    }

    public recordStats(stats: WorkerStats): void {
        this.stats.set(stats.machineId, stats);
    }

    public async onWorkerJoined(machineId: string): Promise<void> {
        log.info('Worker joined; filling unowned shards only', { machineId });
        await this.fillUnownedShards('join');
    }

    public async maybeRebalance(force = false): Promise<void> {
        const now = Date.now();
        if (!force && now - this.lastRunAt < this.env.rebalanceCooldownMs) {
            return;
        }

        const filled = await this.fillUnownedShards(force ? 'join' : 'rebalance');

        const workers = this.membership
            .listWorkers()
            .filter((w) => !this.updating.has(w.machineId));
        if (workers.length === 0) {
            log.debug('Rebalance skipped: no eligible workers');
            this.lastRunAt = Date.now();
            return;
        }

        const scores = workers.map((w) =>
            computeLoadScore(
                this.stats.get(w.machineId),
                this.env.loadWeights,
                this.shardMap.shardsFor(w.machineId).length,
            ),
        );
        const imbalance = computeImbalance(scores);

        if (!force && imbalance <= this.env.loadImbalanceThreshold) {
            if (filled) {
                log.debug('Rebalance stopped after fill-unowned; load within threshold', {
                    imbalance,
                });
            } else {
                log.debug('Rebalance skipped: balanced', { imbalance });
            }
            this.lastRunAt = Date.now();
            return;
        }

        if (workers.length < 2) {
            this.lastRunAt = Date.now();
            return;
        }

        const owner = new Map<number, string>();
        for (let s = 0; s < this.shardMap.getTotalShards(); s++) {
            const o = this.shardMap.ownerOf(s);
            if (o) owner.set(s, o);
        }

        const strategy = getStrategy(this.env.assignmentStrategy);
        const diff = strategy.propose({
            workers,
            stats: this.stats,
            totalShards: this.shardMap.getTotalShards(),
            owner,
            imbalanceThreshold: this.env.loadImbalanceThreshold,
            maxMoves: this.env.rebalanceMaxMoves,
            minImprovement: this.env.rebalanceMinImprovement,
            weights: this.env.loadWeights,
            excludeMachineIds: this.updating,
            manualShards: this.env.manualShards,
            regionLabelKey: this.env.regionLabelKey,
        });

        log.info('Rebalance proposal', {
            strategy: strategy.id,
            reason: diff.reason,
            moves: diff.moves.length,
            imbalanceBefore: imbalance,
        });
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('crosshost.rebalance', {
                    strategy: strategy.id,
                    moves: diff.moves.length,
                    reason: diff.reason,
                }),
            )
            .catch(() => undefined);

        if (diff.moves.length === 0) {
            this.lastRunAt = Date.now();
            return;
        }

        for (const [mid, shards] of diff.assignments.entries()) {
            const current = this.shardMap.shardsFor(mid);
            const next = [...shards].sort((a, b) => a - b);
            if (
                current.length === next.length &&
                current.every((v, i) => v === next[i])
            ) {
                continue;
            }
            await this.shardMap.assign(mid, next, 'rebalance', this.identifyQueue);
            this.membership.setWorkerShards(mid, next);
            this.membership.bumpGeneration(this.shardMap.getGeneration());
        }

        this.lastRunAt = Date.now();
    }

    private async fillUnownedShards(reason: 'join' | 'rebalance'): Promise<boolean> {
        const workers = this.membership
            .listWorkers()
            .filter((w) => !this.updating.has(w.machineId));
        if (workers.length === 0) return false;

        const total = this.shardMap.getTotalShards();
        const unowned: number[] = [];
        for (let s = 0; s < total; s++) {
            if (!this.shardMap.ownerOf(s)) unowned.push(s);
        }
        if (unowned.length === 0) {
            log.debug('No unowned shards to fill');
            return false;
        }

        const counts = new Map<string, number>();
        for (const w of workers) {
            counts.set(w.machineId, this.shardMap.shardsFor(w.machineId).length);
        }

        const target = new Map<string, number[]>();
        for (const w of workers) {
            target.set(w.machineId, this.shardMap.shardsFor(w.machineId));
        }

        for (const shardId of unowned) {
            let bestId = workers[0].machineId;
            let bestCount = counts.get(bestId) ?? 0;
            for (const w of workers) {
                const c = counts.get(w.machineId) ?? 0;
                if (c < bestCount) {
                    bestCount = c;
                    bestId = w.machineId;
                }
            }
            const list = target.get(bestId);
            if (list) list.push(shardId);
            else target.set(bestId, [shardId]);
            counts.set(bestId, bestCount + 1);
        }

        let changed = false;
        for (const [mid, shards] of target.entries()) {
            const current = this.shardMap.shardsFor(mid);
            const next = [...new Set(shards)].sort((a, b) => a - b);
            if (
                current.length === next.length &&
                current.every((v, i) => v === next[i])
            ) {
                continue;
            }
            changed = true;
            await this.shardMap.assign(mid, next, reason, this.identifyQueue);
            this.membership.setWorkerShards(mid, next);
            this.membership.bumpGeneration(this.shardMap.getGeneration());
            log.info('Fill-unowned assignment published', {
                machineId: mid,
                previous: current,
                next,
                reason,
            });
        }

        return changed;
    }
}
