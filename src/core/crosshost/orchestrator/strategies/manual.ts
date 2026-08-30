import { getLogger } from '#core/utils/logger.js';
import type { AssignmentDiff } from '../../types.js';
import type { AssignmentStrategy, StrategyInput } from './types.js';
import { leastLoadedStrategy } from './leastLoaded.js';

const log = getLogger('CrossHost:Strategy:Manual');

function validateManualOverlay(
    manual: Readonly<Record<string, readonly number[]>>,
    totalShards: number,
    liveMachines: ReadonlySet<string>,
): { ok: true; overlay: Map<number, string> } | { ok: false; message: string } {
    const overlay = new Map<number, string>();
    for (const [machineId, shards] of Object.entries(manual)) {
        if (!liveMachines.has(machineId)) {
            return { ok: false, message: `manual machine not live: ${machineId}` };
        }
        for (const shardId of shards) {
            if (!Number.isInteger(shardId) || shardId < 0 || shardId >= totalShards) {
                return {
                    ok: false,
                    message: `manual shard out of range: ${shardId} machine=${machineId}`,
                };
            }
            const prev = overlay.get(shardId);
            if (prev !== undefined && prev !== machineId) {
                return {
                    ok: false,
                    message: `manual double ownership shard=${shardId} machines=${prev},${machineId}`,
                };
            }
            overlay.set(shardId, machineId);
        }
    }
    return { ok: true, overlay };
}

export const manualStrategy: AssignmentStrategy = {
    id: 'manual',
    propose(input: StrategyInput): AssignmentDiff {
        const live = new Set(
            input.workers
                .filter((w) => !input.excludeMachineIds.has(w.machineId))
                .map((w) => w.machineId),
        );
        const validated = validateManualOverlay(input.manualShards, input.totalShards, live);
        if (!validated.ok) {
            log.error('Manual overlay rejected (all-or-nothing); falling back to least_loaded', {
                message: validated.message,
            });
            const base = leastLoadedStrategy.propose(input);
            return { ...base, reason: `manual rejected: ${validated.message}; ${base.reason}` };
        }

        const seedOwner = new Map(input.owner);
        for (const [shardId, machineId] of validated.overlay.entries()) {
            seedOwner.set(shardId, machineId);
        }

        const seededInput: StrategyInput = {
            ...input,
            owner: seedOwner,
        };
        const base = leastLoadedStrategy.propose(seededInput);
        return { ...base, reason: `manual+least_loaded: ${base.reason}` };
    },
};
