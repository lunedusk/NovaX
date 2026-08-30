import type { AssignmentDiff } from '../../types.js';
import type { AssignmentStrategy, StrategyInput } from './types.js';
import { leastLoadedStrategy } from './leastLoaded.js';
import { computeImbalance, computeLoadScore } from '../metrics.js';

export const stickyStrategy: AssignmentStrategy = {
    id: 'sticky',
    propose(input: StrategyInput): AssignmentDiff {
        const eligible = new Set(
            input.workers
                .filter((w) => !input.excludeMachineIds.has(w.machineId))
                .map((w) => w.machineId),
        );
        if (eligible.size === 0) {
            return { assignments: new Map(), moves: [], reason: 'sticky: no eligible workers' };
        }

        const scores: number[] = [];
        for (const id of eligible) {
            const shardCount = [...input.owner.values()].filter((m) => m === id).length;
            scores.push(computeLoadScore(input.stats.get(id), input.weights, shardCount));
        }
        const imbalance = computeImbalance(scores);
        if (imbalance <= input.imbalanceThreshold) {
            const assignments = new Map<string, number[]>();
            for (const id of eligible) assignments.set(id, []);
            for (const [shardId, mid] of input.owner.entries()) {
                if (!eligible.has(mid)) continue;
                const list = assignments.get(mid) ?? [];
                list.push(shardId);
                assignments.set(mid, list);
            }
            for (const list of assignments.values()) list.sort((a, b) => a - b);
            return {
                assignments,
                moves: [],
                reason: 'sticky: within threshold, keep ownership',
            };
        }
        const base = leastLoadedStrategy.propose(input);
        return { ...base, reason: `sticky→least_loaded: ${base.reason}` };
    },
};
