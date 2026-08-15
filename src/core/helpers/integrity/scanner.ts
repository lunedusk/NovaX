import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { getLogger } from '#core/utils/logger.js';
import { hashFile } from '#core/helpers/hash/index.js';
import type { FileMetadata } from './types.js';

const log = getLogger('IntegrityScanner');

export class IntegrityScanner {
    static readonly #EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', '.data', 'logs', 'configuration', 'data']);
    static readonly #EXCLUDE_EXTENSIONS = new Set(['.log', '.tmp', '.map', '.env', '.bin', '.nc']);
    static readonly #MAX_CONCURRENCY = 50;

    public static async runConcurrently(tasks: (() => Promise<void>)[]): Promise<void> {
        const executing = new Set<Promise<void>>();
        for (const task of tasks) {
            const p = task().finally(() => executing.delete(p));
            executing.add(p);
            if (executing.size >= this.#MAX_CONCURRENCY) {
                await Promise.race(executing);
            }
        }
        await Promise.all(executing);
    }

    public static async calculateFileStats(filePath: string): Promise<FileMetadata> {
        const { hash, size } = await hashFile(filePath);
        return { hash, size };
    }

    public static async *discoverFiles(dir: string, root = dir): AsyncGenerator<{ fullPath: string; relPath: string }> {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const res = path.resolve(dir, entry.name);

            if (entry.isSymbolicLink()) {
                log.warn(`[SECURITY] Symbolic link detected and ignored: ${res}`);
                continue;
            }

            if (entry.isDirectory()) {
                if (this.#EXCLUDE_DIRS.has(entry.name)) continue;
                yield* this.discoverFiles(res, root);
            } else {
                if (this.#EXCLUDE_EXTENSIONS.has(path.extname(entry.name)) || entry.name.startsWith('manifest')) continue;
                yield { fullPath: res, relPath: path.relative(root, res).replace(/\\/g, '/') };
            }
        }
    }
}