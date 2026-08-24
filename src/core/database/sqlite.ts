import Database from 'better-sqlite3';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('SqliteNative');

export class SqliteNativeRegistry {
    private dbs = new Map<string, Database.Database>();

    public connect(alias: string, uri: string): void {
        if (this.dbs.has(alias)) return;

        const filepath = uri.replace(/^sqlite:\/\//, '').replace(/^sqlite:/, '');
        
        log.info(`Initializing Native SQLite [${alias}] at path: ${filepath}`);

        try {
            const db = new Database(filepath);
            
            db.pragma('journal_mode = WAL');
            db.pragma('synchronous = NORMAL');
            db.pragma('temp_store = MEMORY');
            db.pragma('busy_timeout = 5000');

            this.dbs.set(alias, db);
            log.info(`Native SQLite [${alias}] connected successfully.`);
        } catch (error) {
            const err = error as Error;
            log.error(`Failed to initialize SQLite [${alias}]: ${err.message}`, { stack: err.stack });
            throw err;
        }
    }

    public has(alias: string): boolean {
        return this.dbs.has(alias);
    }

    public get(alias: string): Database.Database {
        const db = this.dbs.get(alias);
        if (!db) throw new Error(`Native SQLite database [${alias}] not found!`);
        return db;
    }

    public async pingAll(): Promise<Record<string, boolean>> {
        const status: Record<string, boolean> = {};
        for (const [alias, db] of this.dbs.entries()) {
            try {
                db.prepare('SELECT 1').get();
                status[alias] = true;
            } catch {
                status[alias] = false;
            }
        }
        return status;
    }

    public async disconnectAll(): Promise<void> {
        for (const [alias, db] of this.dbs.entries()) {
            log.info(`Closing Native SQLite connection [${alias}]...`);
            db.close();
            this.dbs.delete(alias);
        }
    }
}

export const sqliteDB = new SqliteNativeRegistry();