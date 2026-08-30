import { getLogger } from '#core/utils/logger.js';
import type { AssignmentDiff } from '../../types.js';
import { computeImbalance, computeLoadScore } from '../metrics.js';
import type { AssignmentStrategy, StrategyInput } from './types.js';

const log = getLogger('CrossHost:Strategy:LeastLoaded');

function cloneOwner(owner: ReadonlyMap<number, string>): Map<number, string> {
    return new Map(owner);
}

function shardsByMachine(owner: Map<number, string>, machineIds: readonly string[]): Map<string, number[]> {
    const map = new Map<string, number[]>();
    for (const id of machineIds) map.set(id, []);
    for (const [shardId, mid] of owner.entries()) {
        const list = map.get(mid);
        if (list) list.push(shardId);
        else map.set(mid, [shardId]);
    }
    for (const list of map.values()) list.sort((a, b) => a - b);
    return map;
}

function scoresFor(
    machineIds: readonly string[],
    owner: Map<number, string>,
    input: StrategyInput,
): Map<string, number> {
    const byMachine = shardsByMachine(owner, machineIds);
    const scores = new Map<string, number>();
    for (const id of machineIds) {
        const shards = byMachine.get(id) ?? [];
        scores.set(id, computeLoadScore(input.stats.get(id), input.weights, shards.length));
    }
    return scores;
}

export const leastLoadedStrategy: AssignmentStrategy = {
    id: 'least_loaded',
    propose(input: StrategyInput): AssignmentDiff {
        const eligible = input.workers
            .filter((w) => !input.excludeMachineIds.has(w.machineId))
            .map((w) => w.machineId);
        if (eligible.length === 0) {
            return { assignments: new Map(), moves: [], reason: 'no eligible workers' };
        }

        const owner = cloneOwner(input.owner);
        for (let s = 0; s < input.totalShards; s++) {
            if (!owner.has(s)) {
                let best = eligible[0];
                let bestScore = Number.POSITIVE_INFINITY;
                for (const id of eligible) {
                    const sc = computeLoadScore(
                        input.stats.get(id),
                        input.weights,
                        [...owner.values()].filter((m) => m === id).length,
                    );
                    if (sc < bestScore) {
                        bestScore = sc;
                        best = id;
                    }
                }
                owner.set(s, best);
            }
        }

        const moves: Array<{ shardId: number; from: string | null; to: string }> = [];
        let donorIndex = 0;

        for (let moved = 0; moved < input.maxMoves; moved++) {
            const scores = scoresFor(eligible, owner, input);
            const scoreList = [...scores.values()];
            const imbalance = computeImbalance(scoreList);
            if (imbalance <= input.imbalanceThreshold) break;

            const sorted = [...eligible].sort(
                (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0),
            );
            const recipients = [...eligible].sort(
                (a, b) => (scores.get(a) ?? 0) - (scores.get(b) ?? 0),
            );

            let didMove = false;
            for (let i = 0; i < sorted.length; i++) {
                const donor = sorted[(donorIndex + i) % sorted.length];
                const donorShards = [...owner.entries()]
                    .filter(([, m]) => m === donor)
                    .map(([s]) => s);
                if (donorShards.length === 0) continue;

                for (const recipient of recipients) {
                    if (recipient === donor) continue;
                    const shardId = donorShards[donorShards.length - 1];
                    const beforeScores = scoreList;
                    const beforeImbalance = computeImbalance(beforeScores);

                    owner.set(shardId, recipient);
                    const afterScores = [...scoresFor(eligible, owner, input).values()];
                    const afterImbalance = computeImbalance(afterScores);
                    const improvement = beforeImbalance - afterImbalance;

                    if (improvement >= input.minImprovement) {
                        moves.push({ shardId, from: donor, to: recipient });
                        donorIndex = (donorIndex + 1) % Math.max(eligible.length, 1);
                        didMove = true;
                        log.debug('LeastLoaded move', {
                            shardId,
                            from: donor,
                            to: recipient,
                            improvement,
                        });
                        break;
                    }
                    owner.set(shardId, donor);
                }
                if (didMove) break;
            }
            if (!didMove) break;
        }

        const assignments = shardsByMachine(owner, eligible);
        return {
            assignments,
            moves,
            reason: moves.length > 0 ? `least_loaded moves=${moves.length}` : 'least_loaded stable',
        };
    },
};
