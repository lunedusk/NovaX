import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import { hashFile } from '#core/helpers/hash/index.js';
import type { FileMetadata } from './types.js';

const log = getLogger('IntegrityScanner');

export class IntegrityScanner {
    static readonly #EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', '.data', 'logs', 'configuration']);
    static readonly #EXCLUDE_EXTENSIONS = new Set(['.log', '.tmp', '.map', '.env', '.bin', '.nc']);
    static readonly #DATA_CODE_SUBDIRS = new Set(['schema', 'rules']);
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

    static #isUnderData(relPath: string): boolean {
        return relPath === 'data' || relPath.startsWith('data/') || relPath.includes('/data/');
    }

    static #dataCodeAllowed(relPath: string, isDirectory: boolean): boolean {
        if (!this.#isUnderData(relPath)) return true;
        const parts = relPath.split('/');
        const dataIdx = parts.indexOf('data');
        if (dataIdx === -1) return true;
        if (parts.length === dataIdx + 1) {
            return isDirectory;
        }
        const sub = parts[dataIdx + 1];
        return this.#DATA_CODE_SUBDIRS.has(sub);
    }

    public static async *discoverFiles(
        dir: string,
        root = dir,
        ignoreHash: ReadonlySet<string> = new Set(),
    ): AsyncGenerator<{ fullPath: string; relPath: string }> {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const res = path.resolve(dir, entry.name);

            if (entry.isSymbolicLink()) {
                log.warn(`[SECURITY] Symbolic link detected and ignored: ${res}`);
                continue;
            }

            const relPath = path.relative(root, res).replace(/\\/g, '/');

            if (entry.isDirectory()) {
                if (this.#EXCLUDE_DIRS.has(entry.name)) continue;
                if (!this.#dataCodeAllowed(relPath, true)) continue;
                yield* this.discoverFiles(res, root, ignoreHash);
            } else {
                if (this.#EXCLUDE_EXTENSIONS.has(path.extname(entry.name)) || entry.name.startsWith('manifest')) continue;
                if (!this.#dataCodeAllowed(relPath, false)) continue;
                if (ignoreHash.has(relPath)) continue;
                yield { fullPath: res, relPath };
            }
        }
    }
}
