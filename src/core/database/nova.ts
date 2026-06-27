import { NovaDB, type NovaConfig } from '#database/index.js';
import { getLogger } from '#core/utils/logger.js';
import path from 'node:path';

const log = getLogger('NovaRegistry');

export class NovaRegistry {
    private dbs = new Map<string, NovaDB>();

    public async connect(alias: string, uri: string, customConfig?: Partial<NovaConfig>): Promise<void> {
        if (this.dbs.has(alias)) return;
        const dbDir = path.resolve(process.cwd(), '.data', 'database', alias);
        
        log.info(`Initializing NovaDB [${alias}] at directory: ${dbDir}`);

        const config: NovaConfig = {
            dbDir: dbDir,
            memtableLimitBytes: 4 * 1024 * 1024,
            blockSize: 4096,
            l0CompactionThreshold: 4,
            groupCommitIntervalMs: 50,
            maxWalBufferBytes: 1024 * 1024,
            blockCacheCapacity: 100,
            tableCacheCapacity: 100,
            maxImmutableMemtables: 5,
            compactionRateLimitBytesPerSec: 50 * 1024 * 1024,
            blockCompression: true,
            numLevels: 7,
            levelSizeMultiplier: 10,
            l1MaxBytes: 256 * 1024 * 1024,
            targetFileSizeBytes: 64 * 1024 * 1024,
            ...customConfig
        };

        try {
            const db = new NovaDB(config);
            this.dbs.set(alias, db);
            log.info(`NovaDB [${alias}] connected successfully.`);
        } catch (error) {
            const err = error as Error;
            log.error(`Failed to initialize NovaDB [${alias}]: ${err.message}`, { stack: err.stack });
            throw err;
        }
    }

    public get(alias: string): NovaDB {
        const db = this.dbs.get(alias);
        if (!db) throw new Error(`NovaDB instance [${alias}] not found!`);
        return db;
    }

    public async pingAll(): Promise<Record<string, boolean>> {
        const status: Record<string, boolean> = {};
        for (const [alias, db] of this.dbs.entries()) {
            status[alias] = !!db; 
        }
        return status;
    }

    public async disconnectAll(): Promise<void> {
        for (const [alias, db] of this.dbs.entries()) {
            log.info(`Closing NovaDB connection [${alias}]...`);
            await db.close();
            this.dbs.delete(alias);
        }
    }
}

export const novaDB = new NovaRegistry();