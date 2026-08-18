import { getLogger } from '#core/utils/logger.js';
import { sqliteDB } from '#core/database/sqlite.js';

const log = getLogger('GuildGate');

export type GuildGateEngine = 'sqlite' | 'postgres' | 'mongo';

export interface GuildGateBackendConfig {
    engine?: GuildGateEngine | string;
    alias?: string;
}

export interface GuildGateRow {
    guildId: string;
    reason: string | null;
    updatedAt: number;
    updatedBy: string | null;
}

export interface GuildPluginGateRow {
    guildId: string;
    pluginId: string;
    reason: string | null;
    updatedAt: number;
    updatedBy: string | null;
}

interface SqliteDb {
    prepare(sql: string): {
        run: (...params: unknown[]) => unknown;
        get: (...params: unknown[]) => any;
        all: (...params: unknown[]) => any[];
    };
    exec(sql: string): void;
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

export class GuildGateManager {
    private ready = false;
    private engine: GuildGateEngine = 'sqlite';
    private alias = 'main';
    private sqlite: SqliteDb | null = null;
    private pgPool: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }> } | null =
        null;
    private mongoColGuild: any = null;
    private mongoColPlugin: any = null;

    private guildCache = new Map<string, boolean>();
    private pluginCache = new Map<string, boolean>();

    public isReady(): boolean {
        return this.ready;
    }

    public getEngine(): GuildGateEngine {
        return this.engine;
    }

    public async init(cfg?: GuildGateBackendConfig | null): Promise<void> {
        const engineRaw = (cfg?.engine || 'sqlite').toString().toLowerCase();
        const alias = (cfg?.alias || 'main').toString().trim() || 'main';
        this.alias = alias;

        if (engineRaw === 'postgres' || engineRaw === 'native-pg' || engineRaw === 'pg') {
            this.engine = 'postgres';
            await this.initPostgres(alias);
        } else if (engineRaw === 'mongo' || engineRaw === 'mongodb') {
            this.engine = 'mongo';
            await this.initMongo(alias);
        } else {
            this.engine = 'sqlite';
            await this.initSqlite(alias);
        }

        await this.warmCache();
        this.ready = true;
        log.info(`GuildGate ready (engine=${this.engine}, alias=${this.alias}).`);
    }

    private async initSqlite(alias: string): Promise<void> {
        try {
            this.sqlite = sqliteDB.get(alias) as unknown as SqliteDb;
        } catch {
            throw new Error(`GuildGate: sqlite alias "${alias}" is not connected.`);
        }
        this.sqlite.exec(`
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

    private async initPostgres(alias: string): Promise<void> {
        const { pgDB } = await import('#core/database/postgres.js');
        try {
            this.pgPool = pgDB.get(alias);
        } catch {
            throw new Error(`GuildGate: postgres alias "${alias}" is not connected.`);
        }
        await this.pgPool.query(`
            CREATE TABLE IF NOT EXISTS guild_gates (
                guild_id   TEXT PRIMARY KEY,
                reason     TEXT,
                updated_at BIGINT NOT NULL,
                updated_by TEXT
            );
        `);
        await this.pgPool.query(`
            CREATE TABLE IF NOT EXISTS guild_plugin_gates (
                guild_id   TEXT NOT NULL,
                plugin_id  TEXT NOT NULL,
                reason     TEXT,
                updated_at BIGINT NOT NULL,
                updated_by TEXT,
                PRIMARY KEY (guild_id, plugin_id)
            );
        `);
        await this.pgPool
            .query(`CREATE INDEX IF NOT EXISTS idx_gpg_plugin ON guild_plugin_gates(plugin_id);`)
            .catch(() => {});
    }

    private async initMongo(alias: string): Promise<void> {
        const { mongoDB } = await import('#core/database/mongo.js');
        let conn: any;
        try {
            conn = mongoDB.get(alias);
        } catch {
            throw new Error(`GuildGate: mongo alias "${alias}" is not connected.`);
        }
        const getCol = (name: string) => {
            if (typeof conn.collection === 'function') return conn.collection(name);
            if (conn.db && typeof conn.db.collection === 'function') return conn.db.collection(name);
            throw new Error(`GuildGate: mongoose connection [${alias}] has no collection()`);
        };
        this.mongoColGuild = getCol('guild_gates');
        this.mongoColPlugin = getCol('guild_plugin_gates');
        await this.mongoColGuild.createIndex({ guild_id: 1 }, { unique: true }).catch(() => {});
        await this.mongoColPlugin
            .createIndex({ guild_id: 1, plugin_id: 1 }, { unique: true })
            .catch(() => {});
    }

    private async warmCache(): Promise<void> {
        this.guildCache.clear();
        this.pluginCache.clear();

        if (this.engine === 'sqlite' && this.sqlite) {
            for (const row of this.sqlite.prepare(`SELECT guild_id FROM guild_gates`).all()) {
                this.guildCache.set(String(row.guild_id), true);
            }
            for (const row of this.sqlite.prepare(`SELECT guild_id, plugin_id FROM guild_plugin_gates`).all()) {
                this.pluginCache.set(`${row.guild_id}\0${row.plugin_id}`, true);
            }
            return;
        }

        if (this.engine === 'postgres' && this.pgPool) {
            const g = await this.pgPool.query(`SELECT guild_id FROM guild_gates`);
            for (const row of g.rows) this.guildCache.set(String(row.guild_id), true);
            const p = await this.pgPool.query(`SELECT guild_id, plugin_id FROM guild_plugin_gates`);
            for (const row of p.rows) this.pluginCache.set(`${row.guild_id}\0${row.plugin_id}`, true);
            return;
        }

        if (this.engine === 'mongo' && this.mongoColGuild && this.mongoColPlugin) {
            const guilds = await this.mongoColGuild.find({}).project({ guild_id: 1 }).toArray();
            for (const row of guilds) this.guildCache.set(String(row.guild_id), true);
            const plugins = await this.mongoColPlugin
                .find({})
                .project({ guild_id: 1, plugin_id: 1 })
                .toArray();
            for (const row of plugins) this.pluginCache.set(`${row.guild_id}\0${row.plugin_id}`, true);
        }
    }

    public isGuildBlocked(guildId: string | null | undefined): boolean {
        if (!this.ready || !guildId) return false;
        return this.guildCache.has(guildId);
    }

    public isPluginBlocked(pluginId: string, guildId: string | null | undefined): boolean {
        if (!this.ready || !guildId || !pluginId) return false;
        if (this.guildCache.has(guildId)) return true;
        return this.pluginCache.has(`${guildId}\0${pluginId}`);
    }

    public isInteractionBlocked(ownerPluginId: string | undefined, guildId: string | null | undefined): boolean {
        if (!this.ready || !guildId) return false;
        if (this.guildCache.has(guildId)) return true;
        if (!ownerPluginId) return false;
        return this.pluginCache.has(`${guildId}\0${ownerPluginId}`);
    }

    public async blockGuild(guildId: string, updatedBy?: string, reason?: string | null): Promise<void> {
        const at = nowSeconds();
        const by = updatedBy ?? null;
        const why = reason ?? null;

        if (this.engine === 'sqlite' && this.sqlite) {
            this.sqlite
                .prepare(
                    `INSERT INTO guild_gates (guild_id, reason, updated_at, updated_by)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(guild_id) DO UPDATE SET reason = excluded.reason, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
                )
                .run(guildId, why, at, by);
        } else if (this.engine === 'postgres' && this.pgPool) {
            await this.pgPool.query(
                `INSERT INTO guild_gates (guild_id, reason, updated_at, updated_by)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (guild_id) DO UPDATE SET reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
                [guildId, why, at, by]
            );
        } else if (this.engine === 'mongo' && this.mongoColGuild) {
            await this.mongoColGuild.updateOne(
                { guild_id: guildId },
                { $set: { guild_id: guildId, reason: why, updated_at: at, updated_by: by } },
                { upsert: true }
            );
        }
        this.guildCache.set(guildId, true);
        log.info(`Guild blocked: ${guildId} by ${by ?? 'system'}`);
    }

    public async unblockGuild(guildId: string): Promise<boolean> {
        let changed = false;
        if (this.engine === 'sqlite' && this.sqlite) {
            const r = this.sqlite.prepare(`DELETE FROM guild_gates WHERE guild_id = ?`).run(guildId) as any;
            changed = (r?.changes ?? 0) > 0;
        } else if (this.engine === 'postgres' && this.pgPool) {
            const r = await this.pgPool.query(`DELETE FROM guild_gates WHERE guild_id = $1`, [guildId]);
            changed = (r.rowCount ?? 0) > 0;
        } else if (this.engine === 'mongo' && this.mongoColGuild) {
            const r = await this.mongoColGuild.deleteOne({ guild_id: guildId });
            changed = (r?.deletedCount ?? 0) > 0;
        }
        this.guildCache.delete(guildId);
        if (changed) log.info(`Guild unblocked: ${guildId}`);
        return changed;
    }

    public async blockPlugin(
        guildId: string,
        pluginId: string,
        updatedBy?: string,
        reason?: string | null
    ): Promise<void> {
        const at = nowSeconds();
        const by = updatedBy ?? null;
        const why = reason ?? null;

        if (this.engine === 'sqlite' && this.sqlite) {
            this.sqlite
                .prepare(
                    `INSERT INTO guild_plugin_gates (guild_id, plugin_id, reason, updated_at, updated_by)
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(guild_id, plugin_id) DO UPDATE SET reason = excluded.reason, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
                )
                .run(guildId, pluginId, why, at, by);
        } else if (this.engine === 'postgres' && this.pgPool) {
            await this.pgPool.query(
                `INSERT INTO guild_plugin_gates (guild_id, plugin_id, reason, updated_at, updated_by)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (guild_id, plugin_id) DO UPDATE SET reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
                [guildId, pluginId, why, at, by]
            );
        } else if (this.engine === 'mongo' && this.mongoColPlugin) {
            await this.mongoColPlugin.updateOne(
                { guild_id: guildId, plugin_id: pluginId },
                {
                    $set: {
                        guild_id: guildId,
                        plugin_id: pluginId,
                        reason: why,
                        updated_at: at,
                        updated_by: by
                    }
                },
                { upsert: true }
            );
        }
        this.pluginCache.set(`${guildId}\0${pluginId}`, true);
        log.info(`Plugin blocked: ${pluginId} @ ${guildId} by ${by ?? 'system'}`);
    }

    public async unblockPlugin(guildId: string, pluginId: string): Promise<boolean> {
        let changed = false;
        if (this.engine === 'sqlite' && this.sqlite) {
            const r = this.sqlite
                .prepare(`DELETE FROM guild_plugin_gates WHERE guild_id = ? AND plugin_id = ?`)
                .run(guildId, pluginId) as any;
            changed = (r?.changes ?? 0) > 0;
        } else if (this.engine === 'postgres' && this.pgPool) {
            const r = await this.pgPool.query(
                `DELETE FROM guild_plugin_gates WHERE guild_id = $1 AND plugin_id = $2`,
                [guildId, pluginId]
            );
            changed = (r.rowCount ?? 0) > 0;
        } else if (this.engine === 'mongo' && this.mongoColPlugin) {
            const r = await this.mongoColPlugin.deleteOne({ guild_id: guildId, plugin_id: pluginId });
            changed = (r?.deletedCount ?? 0) > 0;
        }
        this.pluginCache.delete(`${guildId}\0${pluginId}`);
        if (changed) log.info(`Plugin unblocked: ${pluginId} @ ${guildId}`);
        return changed;
    }

    public async listBlockedGuilds(): Promise<GuildGateRow[]> {
        if (this.engine === 'sqlite' && this.sqlite) {
            return this.sqlite
                .prepare(
                    `SELECT guild_id AS guildId, reason, updated_at AS updatedAt, updated_by AS updatedBy FROM guild_gates ORDER BY updated_at DESC`
                )
                .all() as GuildGateRow[];
        }
        if (this.engine === 'postgres' && this.pgPool) {
            const r = await this.pgPool.query(
                `SELECT guild_id AS "guildId", reason, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM guild_gates ORDER BY updated_at DESC`
            );
            return r.rows as GuildGateRow[];
        }
        if (this.engine === 'mongo' && this.mongoColGuild) {
            const rows = await this.mongoColGuild.find({}).sort({ updated_at: -1 }).toArray();
            return rows.map((r: any) => ({
                guildId: r.guild_id,
                reason: r.reason ?? null,
                updatedAt: r.updated_at,
                updatedBy: r.updated_by ?? null
            }));
        }
        return [];
    }

    public async listBlockedPlugins(guildId?: string): Promise<GuildPluginGateRow[]> {
        if (this.engine === 'sqlite' && this.sqlite) {
            if (guildId) {
                return this.sqlite
                    .prepare(
                        `SELECT guild_id AS guildId, plugin_id AS pluginId, reason, updated_at AS updatedAt, updated_by AS updatedBy FROM guild_plugin_gates WHERE guild_id = ? ORDER BY plugin_id`
                    )
                    .all(guildId) as GuildPluginGateRow[];
            }
            return this.sqlite
                .prepare(
                    `SELECT guild_id AS guildId, plugin_id AS pluginId, reason, updated_at AS updatedAt, updated_by AS updatedBy FROM guild_plugin_gates ORDER BY guild_id, plugin_id`
                )
                .all() as GuildPluginGateRow[];
        }
        if (this.engine === 'postgres' && this.pgPool) {
            if (guildId) {
                const r = await this.pgPool.query(
                    `SELECT guild_id AS "guildId", plugin_id AS "pluginId", reason, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM guild_plugin_gates WHERE guild_id = $1 ORDER BY plugin_id`,
                    [guildId]
                );
                return r.rows as GuildPluginGateRow[];
            }
            const r = await this.pgPool.query(
                `SELECT guild_id AS "guildId", plugin_id AS "pluginId", reason, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM guild_plugin_gates ORDER BY guild_id, plugin_id`
            );
            return r.rows as GuildPluginGateRow[];
        }
        if (this.engine === 'mongo' && this.mongoColPlugin) {
            const q = guildId ? { guild_id: guildId } : {};
            const rows = await this.mongoColPlugin.find(q).sort({ guild_id: 1, plugin_id: 1 }).toArray();
            return rows.map((r: any) => ({
                guildId: r.guild_id,
                pluginId: r.plugin_id,
                reason: r.reason ?? null,
                updatedAt: r.updated_at,
                updatedBy: r.updated_by ?? null
            }));
        }
        return [];
    }
}

export const guildGate = new GuildGateManager();

export function extractGuildIdFromEventArgs(args: unknown[]): string | null {
    for (const a of args) {
        if (a == null || typeof a !== 'object') continue;
        const o = a as Record<string, any>;
        if (typeof o.guildId === 'string' && o.guildId) return o.guildId;
        if (typeof o.guild?.id === 'string' && o.guild.id) return o.guild.id;
        if (typeof o.member?.guild?.id === 'string' && o.member.guild.id) return o.member.guild.id;
        if (typeof o.message?.guildId === 'string' && o.message.guildId) return o.message.guildId;
        if (typeof o.channel?.guildId === 'string' && o.channel.guildId) return o.channel.guildId;
        if (typeof o.id === 'string' && o.members && o.channels) return o.id;
    }
    return null;
}
