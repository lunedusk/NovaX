import type { AssignmentDiff } from '../../types.js';
import type { AssignmentStrategy, StrategyInput } from './types.js';
import { leastLoadedStrategy } from './leastLoaded.js';
import { computeLoadScore } from '../metrics.js';

export const regionAwareStrategy: AssignmentStrategy = {
    id: 'region_aware',
    propose(input: StrategyInput): AssignmentDiff {
        const eligible = input.workers.filter((w) => !input.excludeMachineIds.has(w.machineId));
        if (eligible.length === 0) {
            return { assignments: new Map(), moves: [], reason: 'region_aware: no eligible workers' };
        }

        const owner = new Map(input.owner);
        const moves: Array<{ shardId: number; from: string | null; to: string }> = [];

        for (let shardId = 0; shardId < input.totalShards; shardId++) {
            const current = owner.get(shardId);
            const currentWorker = eligible.find((w) => w.machineId === current);
            const currentRegion = currentWorker?.labels[input.regionLabelKey];

            let best = current && eligible.some((w) => w.machineId === current)
                ? current
                : eligible[0].machineId;
            let bestScore = Number.POSITIVE_INFINITY;

            for (const w of eligible) {
                const region = w.labels[input.regionLabelKey];
                const shardCount = [...owner.values()].filter((m) => m === w.machineId).length;
                let score = computeLoadScore(input.stats.get(w.machineId), input.weights, shardCount);
                if (currentRegion && region === currentRegion) {
                    score -= 1;
                } else if (region && !currentRegion) {
                    score -= 0.25;
                }
                if (score < bestScore) {
                    bestScore = score;
                    best = w.machineId;
                }
            }

            if (current !== best) {
                moves.push({ shardId, from: current ?? null, to: best });
                owner.set(shardId, best);
            } else if (current === undefined) {
                owner.set(shardId, best);
            }
        }

        if (moves.length > input.maxMoves) {
            return leastLoadedStrategy.propose(input);
        }

        const assignments = new Map<string, number[]>();
        for (const w of eligible) assignments.set(w.machineId, []);
        for (const [shardId, mid] of owner.entries()) {
            const list = assignments.get(mid);
            if (list) list.push(shardId);
        }
        for (const list of assignments.values()) list.sort((a, b) => a - b);

        return {
            assignments,
            moves: moves.slice(0, input.maxMoves),
            reason: `region_aware moves=${Math.min(moves.length, input.maxMoves)}`,
        };
    },
};
