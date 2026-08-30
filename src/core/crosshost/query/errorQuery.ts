import type { ErrorListFilter, ErrorOccurrence } from '#core/errors/index.js';
import type { CrossHostEnv, IndexRecordMeta } from '../types.js';
import type { IndexBackend } from '../indexStore/types.js';
import { listIndex } from '../indexStore/query.js';
import type { QueryRpcClient } from './rpc.js';
import { scatterGather, singleMachineGet } from './scatterGather.js';

export interface ErrorQueryDeps {
    env: CrossHostEnv;
    client: QueryRpcClient;
    listMachineIds: () => readonly string[];
    ownerOfShard: (shardId: number) => string | undefined;
    index: IndexBackend | null;
}

function asOccurrences(data: unknown): ErrorOccurrence[] {
    if (!Array.isArray(data)) return [];
    return data as ErrorOccurrence[];
}

export async function queryErrorList(
    deps: ErrorQueryDeps,
    filter: ErrorListFilter & { shardId?: number; limit?: number } = {},
): Promise<{ records: ErrorOccurrence[]; partial: boolean }> {
    if (typeof filter.shardId === 'number') {
        const owner = deps.ownerOfShard(filter.shardId);
        if (!owner) return { records: [], partial: false };
        const res = await deps.client.request(
            owner,
            'error.list',
            filter,
            deps.env.queryTimeoutMs,
        );
        if (!res.ok) return { records: [], partial: true };
        return { records: asOccurrences(res.data), partial: false };
    }

    if (deps.index) {
        const meta = await listIndex(deps.index, {
            kind: 'error',
            limit: filter.limit ?? 50,
        });
        const records: ErrorOccurrence[] = [];
        let partial = false;
        for (const m of meta) {
            const got = await singleMachineGet<ErrorOccurrence | null>({
                client: deps.client,
                machineId: m.machineId,
                op: 'error.get',
                payload: { id: m.id },
                timeoutMs: deps.env.queryTimeoutMs,
            });
            if (got.ok && got.data) records.push(got.data);
            else partial = true;
        }
        return { records, partial };
    }

    const result = await scatterGather({
        client: deps.client,
        machineIds: deps.listMachineIds(),
        op: 'error.list',
        payload: filter,
        timeoutMs: deps.env.queryTimeoutMs,
        concurrency: deps.env.queryConcurrency,
        extract: asOccurrences,
    });
    return { records: result.items, partial: result.partial };
}

export async function queryErrorGet(
    deps: ErrorQueryDeps,
    id: string,
    shardId?: number,
): Promise<{ record: ErrorOccurrence | null; partial: boolean }> {
    if (typeof shardId === 'number') {
        const owner = deps.ownerOfShard(shardId);
        if (!owner) return { record: null, partial: false };
        const got = await singleMachineGet<ErrorOccurrence | null>({
            client: deps.client,
            machineId: owner,
            op: 'error.get',
            payload: { id },
            timeoutMs: deps.env.queryTimeoutMs,
        });
        if (!got.ok) return { record: null, partial: true };
        return { record: got.data, partial: false };
    }

    if (deps.index) {
        const meta = await listIndex(deps.index, { kind: 'error', limit: 500 });
        const hit = meta.find((m: IndexRecordMeta) => m.id === id);
        if (hit) {
            const got = await singleMachineGet<ErrorOccurrence | null>({
                client: deps.client,
                machineId: hit.machineId,
                op: 'error.get',
                payload: { id },
                timeoutMs: deps.env.queryTimeoutMs,
            });
            if (got.ok) return { record: got.data, partial: false };
        }
    }

    const machines = deps.listMachineIds();
    if (machines.length > 0) {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
        const preferred = machines[h % machines.length];
        const probe = await singleMachineGet<ErrorOccurrence | null>({
            client: deps.client,
            machineId: preferred,
            op: 'error.get',
            payload: { id },
            timeoutMs: deps.env.queryTimeoutMs,
        });
        if (probe.ok && probe.data) {
            return { record: probe.data, partial: false };
        }
    }

    const result = await scatterGather({
        client: deps.client,
        machineIds: machines,
        op: 'error.get',
        payload: { id },
        timeoutMs: deps.env.queryTimeoutMs,
        concurrency: deps.env.queryConcurrency,
        extract: (data) => (data ? [data as ErrorOccurrence] : []),
    });
    return {
        record: result.items[0] ?? null,
        partial: result.partial,
    };
}
