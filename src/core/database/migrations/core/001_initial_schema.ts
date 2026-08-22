import type { MigrationContext, MigrationStep } from '../types.js';

async function upSqlitePg(ctx: MigrationContext): Promise<void> {
    const { adapter } = ctx;
    await adapter.exec(`
CREATE TABLE IF NOT EXISTS perm_bits (
    id          TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    scope       TEXT NOT NULL,
    pluginId    TEXT,
    builtIn     INTEGER NOT NULL DEFAULT 0,
    createdAt   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS perm_bwroles (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    color           TEXT NOT NULL,
    bits            TEXT NOT NULL DEFAULT '[]',
    assignedUserIds TEXT NOT NULL DEFAULT '[]',
    createdAt       INTEGER NOT NULL,
    createdBy       TEXT NOT NULL,
    updatedAt       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS perm_sroles (
    id              TEXT PRIMARY KEY,
    guildId         TEXT NOT NULL,
    name            TEXT NOT NULL,
    color           TEXT NOT NULL,
    bits            TEXT NOT NULL DEFAULT '[]',
    assignedUserIds TEXT NOT NULL DEFAULT '[]',
    createdAt       INTEGER NOT NULL,
    createdBy       TEXT NOT NULL,
    updatedAt       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_perm_bwroles_assigned ON perm_bwroles(assignedUserIds);
CREATE INDEX IF NOT EXISTS idx_perm_sroles_guild ON perm_sroles(guildId);

CREATE TABLE IF NOT EXISTS token_global (
    id           TEXT PRIMARY KEY,
    tokenVersion INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS token_devices (
    id           TEXT PRIMARY KEY,
    userId       TEXT NOT NULL,
    deviceId     TEXT NOT NULL,
    guildId      TEXT,
    tokenVersion INTEGER NOT NULL DEFAULT 0,
    deviceLabel  TEXT,
    issuedAt     INTEGER NOT NULL,
    lastSeenAt   INTEGER NOT NULL,
    lastJti      TEXT
);

CREATE INDEX IF NOT EXISTS idx_token_devices_user ON token_devices(userId);

CREATE TABLE IF NOT EXISTS guild_gates (
    guild_id   TEXT PRIMARY KEY,
    reason     TEXT,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS guild_plugin_gates (
    guild_id   TEXT NOT NULL,
    plugin_id  TEXT NOT NULL,
    reason     TEXT,
    updated_at INTEGER NOT NULL,
    updated_by TEXT,
    PRIMARY KEY (guild_id, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_gpg_plugin ON guild_plugin_gates(plugin_id);
`);
}

async function upMongo(ctx: MigrationContext): Promise<void> {
    const { mongoDB } = await import('#core/database/mongo.js');
    const conn = mongoDB.get(ctx.adapter.alias);
    const db = conn.db;
    if (!db) return;
    const names = [
        'perm_bits',
        'perm_bwroles',
        'perm_sroles',
        'token_global',
        'token_devices',
        'guild_gates',
        'guild_plugin_gates',
        'schema_migrations',
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
    await ensure('perm_bits', { id: 1 }, true);
    await ensure('perm_bwroles', { id: 1 }, true);
    await ensure('perm_sroles', { id: 1 }, true);
    await ensure('perm_sroles', { guildId: 1 }, false);
    await ensure('token_global', { id: 1 }, true);
    await ensure('token_devices', { id: 1 }, true);
    await ensure('token_devices', { userId: 1 }, false);
    await ensure('guild_gates', { guild_id: 1 }, true);
    await ensure('guild_plugin_gates', { guild_id: 1, plugin_id: 1 }, true);
    await ensure('schema_migrations', { scope: 1, version: 1 }, true);
}

export const initialSchema: MigrationStep = {
    version: 1,
    name: 'initial_schema',
    async up(ctx) {
        if (ctx.engine === 'mongo') {
            await upMongo(ctx);
            return;
        }
        await upSqlitePg(ctx);
    },
};
