import type { IndexBackend } from './types.js';
import type { IndexKind, IndexRecordMeta } from '../types.js';

export async function listIndex(
    backend: IndexBackend,
    opts: { kind?: IndexKind; limit?: number; beforeTs?: number },
): Promise<IndexRecordMeta[]> {
    return backend.list({
        kind: opts.kind,
        limit: opts.limit ?? 50,
        beforeTs: opts.beforeTs,
    });
}
