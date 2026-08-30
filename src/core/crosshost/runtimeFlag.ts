import { secrets } from '#core/helpers/secretManager.js';

let workerActive = false;
let machineId: string | null = null;
let shardIds: readonly number[] = [];

export function markCrossHostWorkerActive(id: string): void {
    workerActive = true;
    machineId = id;
}

export function setCrossHostWorkerShards(shards: readonly number[]): void {
    shardIds = [...shards];
}

export function isCrossHostWorker(): boolean {
    if (workerActive) return true;
    return secrets.getBoolean('CROSS_HOST', false) && secrets.getOptional('CROSS_HOST_ROLE') === 'worker';
}

export function getCrossHostWorkerMachineId(): string | null {
    return machineId ?? secrets.getOptional('CROSS_HOST_MACHINE_ID') ?? null;
}

export function getCrossHostWorkerShards(): readonly number[] {
    return shardIds;
}

export function primaryShardHint(): number | null {
    if (shardIds.length === 0) return null;
    return shardIds[0] ?? null;
}
