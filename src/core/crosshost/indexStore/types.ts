import type { IndexKind, IndexRecordMeta } from '../types.js';

export interface IndexBackend {
    readonly name: string;
    write(meta: IndexRecordMeta): Promise<void>;
    list(opts: {
        kind?: IndexKind;
        limit: number;
        beforeTs?: number;
    }): Promise<IndexRecordMeta[]>;
    trim(retentionDays: number): Promise<number>;
}

export type IndexResolveResult =
    | { enabled: true; backend: IndexBackend }
    | { enabled: false; reason: string };
