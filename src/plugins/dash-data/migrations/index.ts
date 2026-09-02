import type { MigrationStep } from '#core/database/migrations/types.js';

const SQL_TABLES_V1 = `
CREATE TABLE IF NOT EXISTS dash_server_bans (
    guildId TEXT PRIMARY KEY,
    reason TEXT,
    bannedBy TEXT NOT NULL,
    bannedAt BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_member_notes (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    guildId TEXT,
    content TEXT NOT NULL,
    authorId TEXT NOT NULL,
    createdAt BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dash_notes_user ON dash_member_notes(userId, guildId);

CREATE TABLE IF NOT EXISTS dash_theme (
    id TEXT PRIMARY KEY DEFAULT 'current',
    tokens TEXT NOT NULL DEFAULT '{}',
    updatedAt BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_theme_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tokens TEXT NOT NULL,
    createdAt BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_landing_config (
    id TEXT PRIMARY KEY DEFAULT 'current',
    config TEXT NOT NULL DEFAULT '{}',
    updatedAt BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_deletion_requests (
    userId TEXT PRIMARY KEY,
    requestedAt BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS dash_lang_overrides (
    guildId TEXT PRIMARY KEY,
    overrides TEXT NOT NULL DEFAULT '{}',
    updatedAt BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_server_plugin_config (
    guildId TEXT NOT NULL,
    pluginId TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    updatedAt BIGINT NOT NULL,
    PRIMARY KEY (guildId, pluginId)
);

CREATE TABLE IF NOT EXISTS dash_global_member_bans (
    userId TEXT PRIMARY KEY,
    reason TEXT,
    bannedBy TEXT NOT NULL,
    bannedAt BIGINT NOT NULL
);
`;

const SQL_TABLES_V2 = `
CREATE TABLE IF NOT EXISTS dash_kv (
    ns TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updatedAt BIGINT NOT NULL,
    PRIMARY KEY (ns, key)
);

CREATE TABLE IF NOT EXISTS dash_layouts (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    guildId TEXT,
    name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    schemaVersion INTEGER NOT NULL DEFAULT 1,
    grid TEXT NOT NULL DEFAULT '{}',
    navOrder TEXT,
    themeOverrideId TEXT,
    updatedAt BIGINT NOT NULL,
    updatedBy TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dash_layouts_scope ON dash_layouts(scope, guildId);

CREATE TABLE IF NOT EXISTS dash_surface_flags (
    pluginId TEXT NOT NULL,
    surfaceId TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updatedAt BIGINT NOT NULL,
    updatedBy TEXT,
    PRIMARY KEY (pluginId, surfaceId)
);
`;

const PG_ALTER_EPOCH_MS_TO_BIGINT = [
    ['dash_server_bans', 'bannedAt'],
    ['dash_member_notes', 'createdAt'],
    ['dash_theme', 'updatedAt'],
    ['dash_theme_presets', 'createdAt'],
    ['dash_landing_config', 'updatedAt'],
    ['dash_deletion_requests', 'requestedAt'],
    ['dash_lang_overrides', 'updatedAt'],
    ['dash_server_plugin_config', 'updatedAt'],
    ['dash_global_member_bans', 'bannedAt'],
    ['dash_kv', 'updatedAt'],
    ['dash_layouts', 'updatedAt'],
    ['dash_surface_flags', 'updatedAt'],
] as const;

async function ensureNovaIndexes(): Promise<void> {
    return;
}

async function upMongoV1(ctx: Parameters<MigrationStep['up']>[0]): Promise<void> {
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

async function upMongoV2(ctx: Parameters<MigrationStep['up']>[0]): Promise<void> {
    const { mongoDB } = await import('#core/database/mongo.js');
    const conn = mongoDB.get(ctx.adapter.alias);
    const db = conn.db;
    if (!db) return;
    const names = ['dash_kv', 'dash_layouts', 'dash_surface_flags'];
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
    await ensure('dash_kv', { ns: 1, key: 1 }, true);
    await ensure('dash_layouts', { id: 1 }, true);
    await ensure('dash_layouts', { scope: 1, guildId: 1 }, false);
    await ensure('dash_surface_flags', { pluginId: 1, surfaceId: 1 }, true);
}

async function alterEpochColumnsToBigint(
    ctx: Parameters<MigrationStep['up']>[0],
): Promise<void> {
    if (ctx.engine === 'mongo') return;

    if (ctx.engine === 'postgres') {
        for (const [table, column] of PG_ALTER_EPOCH_MS_TO_BIGINT) {
            const sp = `sp_alter_${table}_${column}`.replace(/[^a-zA-Z0-9_]/g, '_');
            try {
                await ctx.adapter.exec(`SAVEPOINT ${sp}`);
                await ctx.adapter.exec(
                    `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE BIGINT USING ${column}::bigint`,
                );
                await ctx.adapter.exec(`RELEASE SAVEPOINT ${sp}`);
            } catch (err: unknown) {
                try {
                    await ctx.adapter.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
                } catch {

                }
                const msg = err instanceof Error ? err.message : String(err);
                if (
                    /does not exist/i.test(msg) ||
                    /already/i.test(msg) ||
                    /cannot cast/i.test(msg) ||
                    /column .* is of type bigint/i.test(msg) ||
                    /cannot alter/i.test(msg)
                ) {
                    continue;
                }
            }
        }
        return;
    }
}

export const migrations: MigrationStep[] = [
    {
        version: 1,
        name: 'dash_data_schema',
        async up(ctx) {
            if (ctx.engine === 'mongo') {
                await upMongoV1(ctx);
                return;
            }
            await ctx.adapter.exec(SQL_TABLES_V1);
            if (ctx.engine === 'postgres') {
                await alterEpochColumnsToBigint(ctx);
            }
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
    {
        version: 2,
        name: 'dash_data_kv_layouts_flags',
        async up(ctx) {
            if (ctx.engine === 'mongo') {
                await upMongoV2(ctx);
                return;
            }
            await ctx.adapter.exec(SQL_TABLES_V2);
        },
    },
    {
        version: 3,
        name: 'dash_data_epoch_ms_bigint',
        async up(ctx) {
            await alterEpochColumnsToBigint(ctx);
        },
    },
];
