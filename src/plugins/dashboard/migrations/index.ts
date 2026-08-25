import type { MigrationStep } from '#core/database/migrations/types.js';

const SQL_TABLES = `
CREATE TABLE IF NOT EXISTS dash_server_bans (
    guildId TEXT PRIMARY KEY,
    reason TEXT,
    bannedBy TEXT NOT NULL,
    bannedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_member_notes (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    guildId TEXT,
    content TEXT NOT NULL,
    authorId TEXT NOT NULL,
    createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dash_notes_user ON dash_member_notes(userId, guildId);

CREATE TABLE IF NOT EXISTS dash_theme (
    id TEXT PRIMARY KEY DEFAULT 'current',
    tokens TEXT NOT NULL DEFAULT '{}',
    updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_theme_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tokens TEXT NOT NULL,
    createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_landing_config (
    id TEXT PRIMARY KEY DEFAULT 'current',
    config TEXT NOT NULL DEFAULT '{}',
    updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_deletion_requests (
    userId TEXT PRIMARY KEY,
    requestedAt INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS dash_lang_overrides (
    guildId TEXT PRIMARY KEY,
    overrides TEXT NOT NULL DEFAULT '{}',
    updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_server_plugin_config (
    guildId TEXT NOT NULL,
    pluginId TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    updatedAt INTEGER NOT NULL,
    PRIMARY KEY (guildId, pluginId)
);

CREATE TABLE IF NOT EXISTS dash_global_member_bans (
    userId TEXT PRIMARY KEY,
    reason TEXT,
    bannedBy TEXT NOT NULL,
    bannedAt INTEGER NOT NULL
);
`;

async function ensureNovaIndexes(): Promise<void> {
    try {
        const { novaDB } = await import('#core/database/nova.js');
        const nova = novaDB.get('main');
        const infractions = await nova.collection('dash_infractions');
        await infractions.createIndex('guildId');
        await infractions.createIndex('userId');
        const auditLog = await nova.collection('dash_audit_log');
        await auditLog.createIndex('guildId');
        const cmdCounters = await nova.collection('dash_command_counters');
        await cmdCounters.createIndex('date');
    } catch {
        return;
    }
}

async function upMongo(ctx: Parameters<MigrationStep['up']>[0]): Promise<void> {
    const { mongoDB } = await import('#core/database/mongo.js');
    const conn = mongoDB.get(ctx.adapter.alias);
    const db = conn.db;
    if (!db) return;
    const names = [
        'dash_server_bans',
        'dash_member_notes',
        'dash_theme',
        'dash_theme_presets',
        'dash_landing_config',
        'dash_deletion_requests',
        'dash_lang_overrides',
        'dash_server_plugin_config',
        'dash_global_member_bans',
    ];
    const existing = await db.listCollections({}, { nameOnly: true }).toArray();
    const have = new Set(existing.map((c: { name: string }) => c.name));
    for (const name of names) {
        if (!have.has(name)) await db.createCollection(name);
    }
    const ensure = async (name: string, keys: Record<string, number>, unique = false) => {
        try {
            await db.collection(name).createIndex(keys, { unique });
        } catch {
            return;
        }
    };
    await ensure('dash_server_bans', { guildId: 1 }, true);
    await ensure('dash_member_notes', { id: 1 }, true);
    await ensure('dash_member_notes', { userId: 1, guildId: 1 }, false);
    await ensure('dash_theme', { id: 1 }, true);
    await ensure('dash_theme_presets', { id: 1 }, true);
    await ensure('dash_landing_config', { id: 1 }, true);
    await ensure('dash_deletion_requests', { userId: 1 }, true);
    await ensure('dash_lang_overrides', { guildId: 1 }, true);
    await ensure('dash_server_plugin_config', { guildId: 1, pluginId: 1 }, true);
    await ensure('dash_global_member_bans', { userId: 1 }, true);
    await ensureNovaIndexes();
}

export const migrations: MigrationStep[] = [
    {
        version: 1,
        name: 'dashboard_schema',
        async up(ctx) {
            if (ctx.engine === 'mongo') {
                await upMongo(ctx);
                return;
            }

            await ctx.adapter.exec(SQL_TABLES);

            const now = Date.now();
            if (ctx.engine === 'postgres') {
                await ctx.adapter.run(
                    `INSERT INTO dash_theme (id, tokens, updatedAt) VALUES ('current', '{}', ?)
                     ON CONFLICT (id) DO NOTHING`,
                    [now],
                );
                await ctx.adapter.run(
                    `INSERT INTO dash_landing_config (id, config, updatedAt) VALUES ('current', '{}', ?)
                     ON CONFLICT (id) DO NOTHING`,
                    [now],
                );
            } else {
                await ctx.adapter.run(
                    `INSERT OR IGNORE INTO dash_theme (id, tokens, updatedAt) VALUES ('current', '{}', ?)`,
                    [now],
                );
                await ctx.adapter.run(
                    `INSERT OR IGNORE INTO dash_landing_config (id, config, updatedAt) VALUES ('current', '{}', ?)`,
                    [now],
                );
            }

            await ensureNovaIndexes();
        },
    },
];
