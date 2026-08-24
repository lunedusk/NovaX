import { getLogger } from '#core/utils/logger.js';
import { sqliteDB } from '#core/database/sqlite.js';
import { cacheFacade } from '#core/manager/cacheFacade.js';

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

interface SqliteRunResult {
    changes: number;
    lastInsertRowid: number | bigint;
}

interface SqliteDb {
    prepare(sql: string): {
        run: (...params: unknown[]) => SqliteRunResult;
        get: (...params: unknown[]) => Record<string, unknown> | undefined;
        all: (...params: unknown[]) => Record<string, unknown>[];
    };
    exec(sql: string): void;
}

interface PgQueryResult {
    rows: Record<string, unknown>[];
    rowCount?: number | null;
}

interface MongoGateDoc {
    guild_id?: string;
    plugin_id?: string;
    reason?: string | null;
    updated_at?: number;
    updated_by?: string | null;
    [key: string]: unknown;
}

interface MongoGateCollection {
    find(filter: object): {
        project(spec: object): { toArray(): Promise<MongoGateDoc[]> };
        sort(spec: object): { toArray(): Promise<MongoGateDoc[]> };
        toArray(): Promise<MongoGateDoc[]>;
    };
    updateOne(filter: object, update: object, opts?: { upsert?: boolean }): Promise<unknown>;
    deleteOne(filter: object): Promise<{ deletedCount?: number }>;
}

type MongoConn = {
    collection?: (name: string) => MongoGateCollection;
    db?: { collection: (name: string) => MongoGateCollection };
};

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function nestString(obj: unknown, path: string[]): string | null {
    let cur: unknown = obj;
    for (const key of path) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return null;
        cur = (cur as Record<string, unknown>)[key];
    }
    return typeof cur === 'string' && cur ? cur : null;
}

export class GuildGateManager {
    private ready = false;
    private engine: GuildGateEngine = 'sqlite';
    private alias = 'main';
    private sqlite: SqliteDb | null = null;
    private pgPool: { query: (text: string, params?: unknown[]) => Promise<PgQueryResult> } | null = null;
    private mongoColGuild: MongoGateCollection | null = null;
    private mongoColPlugin: MongoGateCollection | null = null;

    private readonly presence = cacheFacade.guildGate();

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
            this.sqlite = sqliteDB.get(alias) as SqliteDb;
        } catch {
            throw new Error(`GuildGate: sqlite alias "${alias}" is not connected.`);
        }
    }

    private async initPostgres(alias: string): Promise<void> {
        const { pgDB } = await import('#core/database/postgres.js');
        try {
            this.pgPool = pgDB.get(alias) as { query: (text: string, params?: unknown[]) => Promise<PgQueryResult> };
        } catch {
            throw new Error(`GuildGate: postgres alias "${alias}" is not connected.`);
        }
    }

    private async initMongo(alias: string): Promise<void> {
        const { mongoDB } = await import('#core/database/mongo.js');
        let conn: MongoConn;
        try {
            conn = mongoDB.get(alias) as MongoConn;
        } catch {
            throw new Error(`GuildGate: mongo alias "${alias}" is not connected.`);
        }
        const getCol = (name: string): MongoGateCollection => {
            if (typeof conn.collection === 'function') return conn.collection(name);
            if (conn.db && typeof conn.db.collection === 'function') return conn.db.collection(name);
            throw new Error(`GuildGate: mongoose connection [${alias}] has no collection()`);
        };
        this.mongoColGuild = getCol('guild_gates');
        this.mongoColPlugin = getCol('guild_plugin_gates');
    }

    private async warmCache(): Promise<void> {
        this.presence.clearPresence();
        const guildKeys: string[] = [];
        const pluginKeys: string[] = [];

        if (this.engine === 'sqlite' && this.sqlite) {
            for (const row of this.sqlite.prepare(`SELECT guild_id FROM guild_gates`).all()) {
                guildKeys.push(`g:${String(row.guild_id)}`);
            }
            for (const row of this.sqlite.prepare(`SELECT guild_id, plugin_id FROM guild_plugin_gates`).all()) {
                pluginKeys.push(`p:${row.guild_id}\0${row.plugin_id}`);
            }
            this.presence.loadPresence(guildKeys);
            this.presence.loadPresence(pluginKeys);
            return;
        }

        if (this.engine === 'postgres' && this.pgPool) {
            const g = await this.pgPool.query(`SELECT guild_id FROM guild_gates`);
            for (const row of g.rows) guildKeys.push(`g:${String(row.guild_id)}`);
            const p = await this.pgPool.query(`SELECT guild_id, plugin_id FROM guild_plugin_gates`);
            for (const row of p.rows) pluginKeys.push(`p:${row.guild_id}\0${row.plugin_id}`);
            this.presence.loadPresence(guildKeys);
            this.presence.loadPresence(pluginKeys);
            return;
        }

        if (this.engine === 'mongo' && this.mongoColGuild && this.mongoColPlugin) {
            const guilds = await this.mongoColGuild.find({}).project({ guild_id: 1 }).toArray();
            for (const row of guilds) guildKeys.push(`g:${String(row.guild_id)}`);
            const plugins = await this.mongoColPlugin
                .find({})
                .project({ guild_id: 1, plugin_id: 1 })
                .toArray();
            for (const row of plugins) pluginKeys.push(`p:${row.guild_id}\0${row.plugin_id}`);
            this.presence.loadPresence(guildKeys);
            this.presence.loadPresence(pluginKeys);
        }
    }

    public isGuildBlocked(guildId: string | null | undefined): boolean {
        if (!this.ready || !guildId) return false;
        return this.presence.hasPresence(`g:${guildId}`);
    }

    public isPluginBlocked(pluginId: string, guildId: string | null | undefined): boolean {
        if (!this.ready || !guildId || !pluginId) return false;
        if (this.presence.hasPresence(`g:${guildId}`)) return true;
        return this.presence.hasPresence(`p:${guildId}\0${pluginId}`);
    }

    public isInteractionBlocked(ownerPluginId: string | undefined, guildId: string | null | undefined): boolean {
        if (!this.ready || !guildId) return false;
        if (this.presence.hasPresence(`g:${guildId}`)) return true;
        if (!ownerPluginId) return false;
        return this.presence.hasPresence(`p:${guildId}\0${ownerPluginId}`);
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
                     ON CONFLICT(guild_id) DO UPDATE SET reason = excluded.reason, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
                )
                .run(guildId, why, at, by);
        } else if (this.engine === 'postgres' && this.pgPool) {
            await this.pgPool.query(
                `INSERT INTO guild_gates (guild_id, reason, updated_at, updated_by)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (guild_id) DO UPDATE SET reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
                [guildId, why, at, by],
            );
        } else if (this.engine === 'mongo' && this.mongoColGuild) {
            await this.mongoColGuild.updateOne(
                { guild_id: guildId },
                { $set: { guild_id: guildId, reason: why, updated_at: at, updated_by: by } },
                { upsert: true },
            );
        }
        this.presence.setPresence(`g:${guildId}`);
        log.info(`Guild blocked: ${guildId} by ${by ?? 'system'}`);
    }

    public async unblockGuild(guildId: string): Promise<boolean> {
        let changed = false;
        if (this.engine === 'sqlite' && this.sqlite) {
            const r = this.sqlite.prepare(`DELETE FROM guild_gates WHERE guild_id = ?`).run(guildId);
            changed = (r.changes ?? 0) > 0;
        } else if (this.engine === 'postgres' && this.pgPool) {
            const r = await this.pgPool.query(`DELETE FROM guild_gates WHERE guild_id = $1`, [guildId]);
            changed = (r.rowCount ?? 0) > 0;
        } else if (this.engine === 'mongo' && this.mongoColGuild) {
            const r = await this.mongoColGuild.deleteOne({ guild_id: guildId });
            changed = (r.deletedCount ?? 0) > 0;
        }
        this.presence.deletePresence(`g:${guildId}`);
        if (changed) log.info(`Guild unblocked: ${guildId}`);
        return changed;
    }

    public async blockPlugin(
        guildId: string,
        pluginId: string,
        updatedBy?: string,
        reason?: string | null,
    ): Promise<void> {
        const at = nowSeconds();
        const by = updatedBy ?? null;
        const why = reason ?? null;

        if (this.engine === 'sqlite' && this.sqlite) {
            this.sqlite
                .prepare(
                    `INSERT INTO guild_plugin_gates (guild_id, plugin_id, reason, updated_at, updated_by)
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(guild_id, plugin_id) DO UPDATE SET reason = excluded.reason, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
                )
                .run(guildId, pluginId, why, at, by);
        } else if (this.engine === 'postgres' && this.pgPool) {
            await this.pgPool.query(
                `INSERT INTO guild_plugin_gates (guild_id, plugin_id, reason, updated_at, updated_by)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (guild_id, plugin_id) DO UPDATE SET reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
                [guildId, pluginId, why, at, by],
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
                        updated_by: by,
                    },
                },
                { upsert: true },
            );
        }
        this.presence.setPresence(`p:${guildId}\0${pluginId}`);
        log.info(`Plugin blocked: ${pluginId} @ ${guildId} by ${by ?? 'system'}`);
    }

    public async unblockPlugin(guildId: string, pluginId: string): Promise<boolean> {
        let changed = false;
        if (this.engine === 'sqlite' && this.sqlite) {
            const r = this.sqlite
                .prepare(`DELETE FROM guild_plugin_gates WHERE guild_id = ? AND plugin_id = ?`)
                .run(guildId, pluginId);
            changed = (r.changes ?? 0) > 0;
        } else if (this.engine === 'postgres' && this.pgPool) {
            const r = await this.pgPool.query(
                `DELETE FROM guild_plugin_gates WHERE guild_id = $1 AND plugin_id = $2`,
                [guildId, pluginId],
            );
            changed = (r.rowCount ?? 0) > 0;
        } else if (this.engine === 'mongo' && this.mongoColPlugin) {
            const r = await this.mongoColPlugin.deleteOne({ guild_id: guildId, plugin_id: pluginId });
            changed = (r.deletedCount ?? 0) > 0;
        }
        this.presence.deletePresence(`p:${guildId}\0${pluginId}`);
        if (changed) log.info(`Plugin unblocked: ${pluginId} @ ${guildId}`);
        return changed;
    }

    public async listBlockedGuilds(): Promise<GuildGateRow[]> {
        if (this.engine === 'sqlite' && this.sqlite) {
            return this.sqlite
                .prepare(
                    `SELECT guild_id AS guildId, reason, updated_at AS updatedAt, updated_by AS updatedBy FROM guild_gates ORDER BY updated_at DESC`,
                )
                .all() as unknown as GuildGateRow[];
        }
        if (this.engine === 'postgres' && this.pgPool) {
            const r = await this.pgPool.query(
                `SELECT guild_id AS "guildId", reason, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM guild_gates ORDER BY updated_at DESC`,
            );
            return r.rows as unknown as GuildGateRow[];
        }
        if (this.engine === 'mongo' && this.mongoColGuild) {
            const rows = await this.mongoColGuild.find({}).sort({ updated_at: -1 }).toArray();
            return rows.map((r: MongoGateDoc) => ({
                guildId: String(r.guild_id ?? ''),
                reason: r.reason ?? null,
                updatedAt: Number(r.updated_at ?? 0),
                updatedBy: r.updated_by ?? null,
            }));
        }
        return [];
    }

    public async listBlockedPlugins(guildId?: string): Promise<GuildPluginGateRow[]> {
        if (this.engine === 'sqlite' && this.sqlite) {
            if (guildId) {
                return this.sqlite
                    .prepare(
                        `SELECT guild_id AS guildId, plugin_id AS pluginId, reason, updated_at AS updatedAt, updated_by AS updatedBy FROM guild_plugin_gates WHERE guild_id = ? ORDER BY plugin_id`,
                    )
                    .all(guildId) as unknown as GuildPluginGateRow[];
            }
            return this.sqlite
                .prepare(
                    `SELECT guild_id AS guildId, plugin_id AS pluginId, reason, updated_at AS updatedAt, updated_by AS updatedBy FROM guild_plugin_gates ORDER BY guild_id, plugin_id`,
                )
                .all() as unknown as GuildPluginGateRow[];
        }
        if (this.engine === 'postgres' && this.pgPool) {
            if (guildId) {
                const r = await this.pgPool.query(
                    `SELECT guild_id AS "guildId", plugin_id AS "pluginId", reason, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM guild_plugin_gates WHERE guild_id = $1 ORDER BY plugin_id`,
                    [guildId],
                );
                return r.rows as unknown as GuildPluginGateRow[];
            }
            const r = await this.pgPool.query(
                `SELECT guild_id AS "guildId", plugin_id AS "pluginId", reason, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM guild_plugin_gates ORDER BY guild_id, plugin_id`,
            );
            return r.rows as unknown as GuildPluginGateRow[];
        }
        if (this.engine === 'mongo' && this.mongoColPlugin) {
            const q = guildId ? { guild_id: guildId } : {};
            const rows = await this.mongoColPlugin.find(q).sort({ guild_id: 1, plugin_id: 1 }).toArray();
            return rows.map((r: MongoGateDoc) => ({
                guildId: String(r.guild_id ?? ''),
                pluginId: String(r.plugin_id ?? ''),
                reason: r.reason ?? null,
                updatedAt: Number(r.updated_at ?? 0),
                updatedBy: r.updated_by ?? null,
            }));
        }
        return [];
    }
}

export const guildGate = new GuildGateManager();

export function extractGuildIdFromEventArgs(args: unknown[]): string | null {
    for (const a of args) {
        if (a == null || typeof a !== 'object') continue;
        const o = a as Record<string, unknown>;
        if (typeof o.guildId === 'string' && o.guildId) return o.guildId;
        const guildId = nestString(o, ['guild', 'id']);
        if (guildId) return guildId;
        const memberGuildId = nestString(o, ['member', 'guild', 'id']);
        if (memberGuildId) return memberGuildId;
        const messageGuildId = nestString(o, ['message', 'guildId']);
        if (messageGuildId) return messageGuildId;
        const channelGuildId = nestString(o, ['channel', 'guildId']);
        if (channelGuildId) return channelGuildId;
        if (typeof o.id === 'string' && o.members && o.channels) return o.id;
    }
    return null;
}
