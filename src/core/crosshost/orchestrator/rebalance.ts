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

    public async maybeRebalance(force = false): Promise<void> {
        const now = Date.now();
        if (!force && now - this.lastRunAt < this.env.rebalanceCooldownMs) {
            return;
        }

        const workers = this.membership
            .listWorkers()
            .filter((w) => !this.updating.has(w.machineId));
        if (workers.length === 0) {
            log.debug('Rebalance skipped: no eligible workers');
            return;
        }

        const owner = new Map<number, string>();
        for (let s = 0; s < this.shardMap.getTotalShards(); s++) {
            const o = this.shardMap.ownerOf(s);
            if (o) owner.set(s, o);
        }

        const scores = workers.map((w) =>
            computeLoadScore(
                this.stats.get(w.machineId),
                this.env.loadWeights,
                this.shardMap.shardsFor(w.machineId).length,
            ),
        );
        const imbalance = computeImbalance(scores);
        const hasUnassigned = owner.size < this.shardMap.getTotalShards();
        const hasEmptyWorker = workers.some(
            (w) => this.shardMap.shardsFor(w.machineId).length === 0,
        );

        if (
            !force &&
            imbalance <= this.env.loadImbalanceThreshold &&
            !hasUnassigned &&
            !hasEmptyWorker
        ) {
            log.debug('Rebalance skipped: balanced', { imbalance });
            return;
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

        for (const [machineId, shards] of diff.assignments.entries()) {
            const current = this.shardMap.shardsFor(machineId);
            const next = [...shards].sort((a, b) => a - b);
            if (
                current.length === next.length &&
                current.every((v, i) => v === next[i])
            ) {
                continue;
            }
            await this.shardMap.assign(
                machineId,
                next,
                force ? 'join' : 'rebalance',
                this.identifyQueue,
            );
            this.membership.setWorkerShards(machineId, next);
            this.membership.bumpGeneration(this.shardMap.getGeneration());
        }

        this.lastRunAt = Date.now();
    }
}
