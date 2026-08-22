import type { Connection } from 'mongoose';
import type { Pool } from 'pg';
import type Database from 'better-sqlite3';
import { sqliteDB } from '#core/database/sqlite.js';
import { pgDB } from '#core/database/postgres.js';
import { mongoDB } from '#core/database/mongo.js';
import type { BackendChoice, DataEngine } from '#core/database/backendSelector.js';

export type Row = Record<string, unknown>;

export type MongoFilter = Record<string, unknown>;
export type MongoUpdate = Record<string, unknown>;

export interface MongoCollectionHandle {
    findOne(filter: MongoFilter): Promise<Row | null>;
    find(filter: MongoFilter): Promise<Row[]>;
    updateOne(filter: MongoFilter, update: MongoUpdate, opts?: { upsert?: boolean }): Promise<void>;
    deleteOne(filter: MongoFilter): Promise<number>;
    deleteMany(filter: MongoFilter): Promise<number>;
    insertOne(doc: Row): Promise<void>;
}

export interface SqlAdapter {
    readonly engine: DataEngine;
    readonly alias: string;
    exec(sql: string): Promise<void>;
    run(sql: string, params?: unknown[]): Promise<void>;
    get(sql: string, params?: unknown[]): Promise<Row | null>;
    all(sql: string, params?: unknown[]): Promise<Row[]>;
    withTransaction(fn: () => Promise<void> | void): Promise<void>;
    mongoCollection(name: string): MongoCollectionHandle;
}

function toPg(sql: string): string {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

class SqliteAdapter implements SqlAdapter {
    readonly engine = 'sqlite' as const;
    readonly alias: string;
    private readonly db: Database.Database;

    constructor(alias: string) {
        this.alias = alias;
        this.db = sqliteDB.get(alias);
    }

    async exec(sql: string): Promise<void> {
        this.db.exec(sql);
    }

    async run(sql: string, params: unknown[] = []): Promise<void> {
        this.db.prepare(sql).run(...(params as Parameters<Database.Statement['run']>));
    }

    async get(sql: string, params: unknown[] = []): Promise<Row | null> {
        const row = this.db.prepare(sql).get(...(params as Parameters<Database.Statement['get']>));
        if (row === undefined || row === null) return null;
        return row as Row;
    }

    async all(sql: string, params: unknown[] = []): Promise<Row[]> {
        return this.db.prepare(sql).all(...(params as Parameters<Database.Statement['all']>)) as Row[];
    }

    async withTransaction(fn: () => Promise<void> | void): Promise<void> {
        const wrapped = this.db.transaction(() => {
            const result = fn();
            if (result !== undefined && result !== null && typeof (result as Promise<void>).then === 'function') {
                throw new Error('Sqlite transactions must be synchronous');
            }
        });
        wrapped();
    }

    mongoCollection(): never {
        throw new Error('mongoCollection is only available on mongo engine');
    }
}

class PostgresAdapter implements SqlAdapter {
    readonly engine = 'postgres' as const;
    readonly alias: string;
    private readonly pool: Pool;

    constructor(alias: string) {
        this.alias = alias;
        this.pool = pgDB.get(alias);
    }

    async exec(sql: string): Promise<void> {
        await this.pool.query(sql);
    }

    async run(sql: string, params: unknown[] = []): Promise<void> {
        await this.pool.query(toPg(sql), params);
    }

    async get(sql: string, params: unknown[] = []): Promise<Row | null> {
        const r = await this.pool.query(toPg(sql), params);
        const row = r.rows[0];
        if (row === undefined) return null;
        return row as Row;
    }

    async all(sql: string, params: unknown[] = []): Promise<Row[]> {
        const r = await this.pool.query(toPg(sql), params);
        return r.rows as Row[];
    }

    async withTransaction(fn: () => Promise<void> | void): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await fn();
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    mongoCollection(): never {
        throw new Error('mongoCollection is only available on mongo engine');
    }
}

class MongoAdapter implements SqlAdapter {
    readonly engine = 'mongo' as const;
    readonly alias: string;
    private readonly conn: Connection;

    constructor(alias: string) {
        this.alias = alias;
        this.conn = mongoDB.get(alias);
    }

    async exec(_sql: string): Promise<void> {}

    async run(_sql: string, _params?: unknown[]): Promise<void> {
        throw new Error('SQL run is not supported on mongo; use mongoCollection');
    }

    async get(_sql: string, _params?: unknown[]): Promise<Row | null> {
        throw new Error('SQL get is not supported on mongo; use mongoCollection');
    }

    async all(_sql: string, _params?: unknown[]): Promise<Row[]> {
        throw new Error('SQL all is not supported on mongo; use mongoCollection');
    }

    async withTransaction(fn: () => Promise<void> | void): Promise<void> {
        await fn();
    }

    mongoCollection(name: string): MongoCollectionHandle {
        const db = this.conn.db;
        if (!db) throw new Error(`Mongo connection [${this.alias}] has no db`);
        const col = db.collection(name);
        return {
            async findOne(filter: MongoFilter): Promise<Row | null> {
                const doc = await col.findOne(filter);
                if (!doc) return null;
                return doc as Row;
            },
            async find(filter: MongoFilter): Promise<Row[]> {
                const docs = await col.find(filter).toArray();
                return docs as Row[];
            },
            async updateOne(filter: MongoFilter, update: MongoUpdate, opts?: { upsert?: boolean }): Promise<void> {
                await col.updateOne(filter, update, { upsert: opts?.upsert ?? false });
            },
            async deleteOne(filter: MongoFilter): Promise<number> {
                const r = await col.deleteOne(filter);
                return r.deletedCount ?? 0;
            },
            async deleteMany(filter: MongoFilter): Promise<number> {
                const r = await col.deleteMany(filter);
                return r.deletedCount ?? 0;
            },
            async insertOne(doc: Row): Promise<void> {
                await col.insertOne(doc);
            },
        };
    }
}

export function openSqlAdapter(choice: BackendChoice): SqlAdapter {
    if (choice.engine === 'sqlite') return new SqliteAdapter(choice.alias);
    if (choice.engine === 'postgres') return new PostgresAdapter(choice.alias);
    return new MongoAdapter(choice.alias);
}
