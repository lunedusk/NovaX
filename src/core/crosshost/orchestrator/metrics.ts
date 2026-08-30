import type { LoadWeights, WorkerStats } from '../types.js';

export function computeLoadScore(stats: WorkerStats | undefined, weights: LoadWeights, shardCount: number): number {
    if (!stats) {
        return weights.shard * shardCount;
    }
    const members = stats.memberCount === null ? 0 : stats.memberCount * weights.member;
    return (
        weights.guild * stats.guildCount +
        members +
        weights.event * stats.eventRate +
        weights.command * stats.commandRate +
        weights.shard * shardCount
    );
}

export function computeImbalance(scores: readonly number[]): number {
    if (scores.length === 0) return 0;
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const denom = Math.max(avg, 1e-6);
    return (max - min) / denom;
}
