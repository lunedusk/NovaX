import type { MigrationContext, MigrationStep } from '../types.js';

async function upSqlitePg(ctx: MigrationContext): Promise<void> {
    const { adapter } = ctx;
    await adapter.exec(`
CREATE TABLE IF NOT EXISTS error_occurrences (
    id         TEXT    PRIMARY KEY,
    code       TEXT    NOT NULL,
    category   TEXT    NOT NULL,
    severity   TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    context    TEXT    NOT NULL DEFAULT '{}',
    count      INTEGER NOT NULL DEFAULT 1,
    first_seen BIGINT  NOT NULL,
    last_seen  BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_last_seen ON error_occurrences(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_error_code_last_seen ON error_occurrences(code, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_error_category_last_seen ON error_occurrences(category, last_seen DESC);
`);
}

async function upMongo(ctx: MigrationContext): Promise<void> {
    const { mongoDB } = await import('#core/database/mongo.js');
    const conn = mongoDB.get(ctx.adapter.alias);
    const db = conn.db;
    if (!db) return;
    const existing = await db.listCollections({}, { nameOnly: true }).toArray();
    const have = new Set(existing.map((c: { name: string }) => c.name));
    if (!have.has('error_occurrences')) {
        await db.createCollection('error_occurrences');
    }
    const ensure = async (keys: Record<string, number>, unique = false) => {
        try {
            await db.collection('error_occurrences').createIndex(keys, { unique });
        } catch {
            return;
        }
    };
    await ensure({ id: 1 }, true);
    await ensure({ lastSeen: -1 }, false);
    await ensure({ code: 1, lastSeen: -1 }, false);
    await ensure({ category: 1, lastSeen: -1 }, false);
}

export const errorOccurrences: MigrationStep = {
    version: 3,
    name: 'error_occurrences',
    async up(ctx) {
        if (ctx.engine === 'mongo') {
            await upMongo(ctx);
            return;
        }
        await upSqlitePg(ctx);
    },
};
