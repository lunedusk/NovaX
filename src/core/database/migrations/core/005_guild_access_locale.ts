import type { MigrationContext, MigrationStep } from '../types.js';

async function upSqlitePg(ctx: MigrationContext): Promise<void> {
    const { adapter } = ctx;
    await adapter.exec(`
CREATE TABLE IF NOT EXISTS guild_access_blacklist (
    guild_id   TEXT PRIMARY KEY,
    reason     TEXT,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS guild_access_whitelist (
    guild_id   TEXT PRIMARY KEY,
    reason     TEXT,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS guild_access_owner_authorized (
    guild_id      TEXT PRIMARY KEY,
    authorized_by TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_locale (
    guild_id   TEXT PRIMARY KEY,
    locale     TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
);
`);
}

async function upMongo(ctx: MigrationContext): Promise<void> {
    const { mongoDB } = await import('#core/database/mongo.js');
    const conn = mongoDB.get(ctx.adapter.alias);
    const db = conn.db;
    if (!db) return;
    const names = [
        'guild_access_blacklist',
        'guild_access_whitelist',
        'guild_access_owner_authorized',
        'guild_locale',
    ];
    const existing = await db.listCollections({}, { nameOnly: true }).toArray();
    const have = new Set(existing.map((c: { name: string }) => c.name));
    for (const name of names) {
        if (!have.has(name)) {
            await db.createCollection(name);
        }
    }
    const ensure = async (name: string, keys: Record<string, number>, unique = false) => {
        try {
            await db.collection(name).createIndex(keys, { unique });
        } catch {
            return;
        }
    };
    await ensure('guild_access_blacklist', { guild_id: 1 }, true);
    await ensure('guild_access_whitelist', { guild_id: 1 }, true);
    await ensure('guild_access_owner_authorized', { guild_id: 1 }, true);
    await ensure('guild_locale', { guild_id: 1 }, true);
}

export const guildAccessLocaleSchema: MigrationStep = {
    version: 5,
    name: 'guild_access_locale',
    async up(ctx) {
        if (ctx.engine === 'mongo') {
            await upMongo(ctx);
            return;
        }
        await upSqlitePg(ctx);
    },
};
