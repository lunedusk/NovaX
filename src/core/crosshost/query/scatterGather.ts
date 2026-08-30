import type { QueryOp, QueryResponseMessage } from '../types.js';
import type { QueryRpcClient } from './rpc.js';

export interface ScatterResult<T> {
    readonly items: T[];
    readonly partial: boolean;
    readonly errors: readonly { machineId: string; error: string }[];
}

async function mapPool<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}

export async function scatterGather<T>(opts: {
    client: QueryRpcClient;
    machineIds: readonly string[];
    op: QueryOp;
    payload: unknown;
    timeoutMs: number;
    concurrency: number;
    extract: (data: unknown) => T[];
}): Promise<ScatterResult<T>> {
    if (opts.machineIds.length === 0) {
        return { items: [], partial: false, errors: [] };
    }
    const responses = await mapPool(opts.machineIds, opts.concurrency, (machineId) =>
        opts.client.request(machineId, opts.op, opts.payload, opts.timeoutMs),
    );
    const items: T[] = [];
    const errors: { machineId: string; error: string }[] = [];
    for (const res of responses) {
        if (!res.ok) {
            errors.push({ machineId: res.machineId, error: res.error ?? 'unknown' });
            continue;
        }
        items.push(...opts.extract(res.data));
    }
    return {
        items,
        partial: errors.length > 0,
        errors,
    };
}

export async function singleMachineGet<T>(opts: {
    client: QueryRpcClient;
    machineId: string;
    op: QueryOp;
    payload: unknown;
    timeoutMs: number;
}): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    const res: QueryResponseMessage = await opts.client.request(
        opts.machineId,
        opts.op,
        opts.payload,
        opts.timeoutMs,
    );
    if (!res.ok) return { ok: false, error: res.error ?? 'QUERY_FAILED' };
    return { ok: true, data: res.data as T };
}
