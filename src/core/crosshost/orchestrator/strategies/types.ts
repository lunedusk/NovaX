import type { AssignmentDiff, LoadWeights, WorkerStats, WorkerView } from '../../types.js';

export interface StrategyInput {
    readonly workers: readonly WorkerView[];
    readonly stats: ReadonlyMap<string, WorkerStats>;
    readonly totalShards: number;
    readonly owner: ReadonlyMap<number, string>;
    readonly imbalanceThreshold: number;
    readonly maxMoves: number;
    readonly minImprovement: number;
    readonly weights: LoadWeights;
    readonly excludeMachineIds: ReadonlySet<string>;
    readonly manualShards: Readonly<Record<string, readonly number[]>>;
    readonly regionLabelKey: string;
}

export interface AssignmentStrategy {
    readonly id: string;
    propose(input: StrategyInput): AssignmentDiff;
}
