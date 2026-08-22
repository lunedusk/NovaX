import type { MigrationContext, MigrationStep } from '../types.js';

async function upSqlitePg(ctx: MigrationContext): Promise<void> {
    const { adapter } = ctx;
    await adapter.exec(`
CREATE TABLE IF NOT EXISTS audit_entries (
    id         TEXT    PRIMARY KEY,
    actor_type TEXT    NOT NULL,
    actor_id   TEXT    NOT NULL,
    action     TEXT    NOT NULL,
    target     TEXT    NOT NULL,
    outcome    TEXT    NOT NULL,
    reason     TEXT,
    meta       TEXT    NOT NULL DEFAULT '{}',
    created_at BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_created ON audit_entries(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON audit_entries(action, created_at DESC);
`);
}

async function upMongo(ctx: MigrationContext): Promise<void> {
    const { mongoDB } = await import('#core/database/mongo.js');
    const conn = mongoDB.get(ctx.adapter.alias);
    const db = conn.db;
    if (!db) return;
    const existing = await db.listCollections({}, { nameOnly: true }).toArray();
    const have = new Set(existing.map((c: { name: string }) => c.name));
    if (!have.has('audit_entries')) {
        await db.createCollection('audit_entries');
    }
    const ensure = async (keys: Record<string, number>, unique = false) => {
        try {
            await db.collection('audit_entries').createIndex(keys, { unique });
        } catch {
            return;
        }
    };
    await ensure({ id: 1 }, true);
    await ensure({ createdAt: -1 }, false);
    await ensure({ actorId: 1, createdAt: -1 }, false);
    await ensure({ action: 1, createdAt: -1 }, false);
}

export const auditEntries: MigrationStep = {
    version: 2,
    name: 'audit_entries',
    async up(ctx) {
        if (ctx.engine === 'mongo') {
            await upMongo(ctx);
            return;
        }
        await upSqlitePg(ctx);
    },
};
