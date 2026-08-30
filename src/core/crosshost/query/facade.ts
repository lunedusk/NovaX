import type { AuditListFilter, AuditRecord } from '#core/audit/index.js';
import type { ErrorListFilter, ErrorOccurrence } from '#core/errors/index.js';
import type { CrossHostEnv } from '../types.js';
import type { IndexBackend as Backend } from '../indexStore/types.js';
import type { QueryRpcClient } from './rpc.js';
import { queryAuditGet, queryAuditList, type AuditQueryDeps } from './auditQuery.js';
import { queryErrorGet, queryErrorList, type ErrorQueryDeps } from './errorQuery.js';

export interface CrossHostQueryFacade {
    audit: {
        list(
            filter?: AuditListFilter & { shardId?: number; limit?: number },
        ): Promise<{ records: AuditRecord[]; partial: boolean }>;
        get(
            id: string,
            opts?: { shardId?: number },
        ): Promise<{ record: AuditRecord | null; partial: boolean }>;
    };
    errors: {
        list(
            filter?: ErrorListFilter & { shardId?: number; limit?: number },
        ): Promise<{ records: ErrorOccurrence[]; partial: boolean }>;
        get(
            id: string,
            opts?: { shardId?: number },
        ): Promise<{ record: ErrorOccurrence | null; partial: boolean }>;
    };
}

let facade: CrossHostQueryFacade | null = null;

export function setCrossHostQueryFacade(next: CrossHostQueryFacade | null): void {
    facade = next;
}

export function getCrossHostQuery(): CrossHostQueryFacade | null {
    return facade;
}

export function buildQueryFacade(deps: {
    env: CrossHostEnv;
    client: QueryRpcClient;
    listMachineIds: () => readonly string[];
    ownerOfShard: (shardId: number) => string | undefined;
    index: Backend | null;
}): CrossHostQueryFacade {
    const auditDeps: AuditQueryDeps = {
        env: deps.env,
        client: deps.client,
        listMachineIds: deps.listMachineIds,
        ownerOfShard: deps.ownerOfShard,
        index: deps.index,
    };
    const errorDeps: ErrorQueryDeps = {
        env: deps.env,
        client: deps.client,
        listMachineIds: deps.listMachineIds,
        ownerOfShard: deps.ownerOfShard,
        index: deps.index,
    };
    return {
        audit: {
            list: (filter) => queryAuditList(auditDeps, filter),
            get: (id, opts) => queryAuditGet(auditDeps, id, opts?.shardId),
        },
        errors: {
            list: (filter) => queryErrorList(errorDeps, filter),
            get: (id, opts) => queryErrorGet(errorDeps, id, opts?.shardId),
        },
    };
}
