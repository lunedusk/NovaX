import type { AuditListFilter } from '#core/audit/index.js';
import type { AuditRecord } from '#core/audit/index.js';
import type { CrossHostEnv, IndexRecordMeta } from '../types.js';
import type { IndexBackend } from '../indexStore/types.js';
import { listIndex } from '../indexStore/query.js';
import type { QueryRpcClient } from './rpc.js';
import { scatterGather, singleMachineGet } from './scatterGather.js';

export interface AuditQueryDeps {
    env: CrossHostEnv;
    client: QueryRpcClient;
    listMachineIds: () => readonly string[];
    ownerOfShard: (shardId: number) => string | undefined;
    index: IndexBackend | null;
}

function asRecords(data: unknown): AuditRecord[] {
    if (!Array.isArray(data)) return [];
    return data as AuditRecord[];
}

export async function queryAuditList(
    deps: AuditQueryDeps,
    filter: AuditListFilter & { shardId?: number; limit?: number } = {},
): Promise<{ records: AuditRecord[]; partial: boolean }> {
    if (typeof filter.shardId === 'number') {
        const owner = deps.ownerOfShard(filter.shardId);
        if (!owner) return { records: [], partial: false };
        const res = await deps.client.request(
            owner,
            'audit.list',
            filter,
            deps.env.queryTimeoutMs,
        );
        if (!res.ok) return { records: [], partial: true };
        return { records: asRecords(res.data), partial: false };
    }

    if (deps.index) {
        const meta = await listIndex(deps.index, {
            kind: 'audit',
            limit: filter.limit ?? 50,
        });
        const byMachine = new Map<string, string[]>();
        for (const m of meta) {
            const list = byMachine.get(m.machineId) ?? [];
            list.push(m.id);
            byMachine.set(m.machineId, list);
        }
        const records: AuditRecord[] = [];
        let partial = false;
        for (const [machineId, ids] of byMachine) {
            for (const id of ids) {
                const got = await singleMachineGet<AuditRecord | null>({
                    client: deps.client,
                    machineId,
                    op: 'audit.get',
                    payload: { id },
                    timeoutMs: deps.env.queryTimeoutMs,
                });
                if (got.ok && got.data) records.push(got.data);
                else partial = true;
            }
        }
        return { records, partial };
    }

    const result = await scatterGather({
        client: deps.client,
        machineIds: deps.listMachineIds(),
        op: 'audit.list',
        payload: filter,
        timeoutMs: deps.env.queryTimeoutMs,
        concurrency: deps.env.queryConcurrency,
        extract: asRecords,
    });
    return { records: result.items, partial: result.partial };
}

export async function queryAuditGet(
    deps: AuditQueryDeps,
    id: string,
    shardId?: number,
): Promise<{ record: AuditRecord | null; partial: boolean }> {
    if (typeof shardId === 'number') {
        const owner = deps.ownerOfShard(shardId);
        if (!owner) return { record: null, partial: false };
        const got = await singleMachineGet<AuditRecord | null>({
            client: deps.client,
            machineId: owner,
            op: 'audit.get',
            payload: { id },
            timeoutMs: deps.env.queryTimeoutMs,
        });
        if (!got.ok) return { record: null, partial: true };
        return { record: got.data, partial: false };
    }

    if (deps.index) {
        const meta = await listIndex(deps.index, { kind: 'audit', limit: 500 });
        const hit = meta.find((m: IndexRecordMeta) => m.id === id);
        if (hit) {
            const got = await singleMachineGet<AuditRecord | null>({
                client: deps.client,
                machineId: hit.machineId,
                op: 'audit.get',
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
        const probe = await singleMachineGet<AuditRecord | null>({
            client: deps.client,
            machineId: preferred,
            op: 'audit.get',
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
        op: 'audit.get',
        payload: { id },
        timeoutMs: deps.env.queryTimeoutMs,
        concurrency: deps.env.queryConcurrency,
        extract: (data) => (data ? [data as AuditRecord] : []),
    });
    return {
        record: result.items[0] ?? null,
        partial: result.partial,
    };
}
