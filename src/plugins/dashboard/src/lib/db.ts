import { type IHeart } from '#core/heart/index.js';
import { resolveDashboardBackend } from '#core/database/backendSelector.js';
import { openSqlAdapter, type SqlAdapter, type Row } from '#core/database/sqlAdapter.js';

let adapter: SqlAdapter | null = null;

export async function ensureDashboardAdapter(): Promise<SqlAdapter> {
    if (adapter) return adapter;
    adapter = openSqlAdapter(resolveDashboardBackend());
    return adapter;
}

export function getDashboardAdapter(): SqlAdapter {
    if (!adapter) {
        adapter = openSqlAdapter(resolveDashboardBackend());
    }
    return adapter;
}

export async function initSchema(_heart: IHeart): Promise<void> {
    await ensureDashboardAdapter();
}

export async function dashGet(sql: string, params: unknown[] = []): Promise<Row | null> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        throw new Error('dashGet is SQL-only; use dashMongo helpers');
    }
    return db.get(sql, params);
}

export async function dashAll(sql: string, params: unknown[] = []): Promise<Row[]> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        throw new Error('dashAll is SQL-only; use dashMongo helpers');
    }
    return db.all(sql, params);
}

export async function dashRun(sql: string, params: unknown[] = []): Promise<void> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        throw new Error('dashRun is SQL-only; use dashMongo helpers');
    }
    await db.run(sql, params);
}

export async function dashMongo(name: string) {
    const db = await ensureDashboardAdapter();
    if (db.engine !== 'mongo') {
        throw new Error('dashMongo requires mongo engine');
    }
    return db.mongoCollection(name);
}

export async function isGloballyBanned(heart: IHeart, userId: string): Promise<boolean> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        const row = await db.mongoCollection('dash_global_member_bans').findOne({
            $or: [{ userId }, { _id: userId }],
        });
        return !!row;
    }
    const row = await db.get(`SELECT userId FROM dash_global_member_bans WHERE userId = ?`, [userId]);
    return !!row;
}

export async function banGlobal(
    heart: IHeart,
    userId: string,
    reason: string | undefined,
    bannedBy: string,
): Promise<void> {
    const db = await ensureDashboardAdapter();
    const at = Date.now();
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_global_member_bans').updateOne(
            { _id: userId },
            {
                $set: {
                    _id: userId,
                    userId,
                    reason: reason ?? null,
                    bannedBy,
                    bannedAt: at,
                },
            },
            { upsert: true },
        );
        return;
    }
    if (db.engine === 'postgres') {
        await db.run(
            `INSERT INTO dash_global_member_bans (userId, reason, bannedBy, bannedAt)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (userId) DO UPDATE SET reason = EXCLUDED.reason, bannedBy = EXCLUDED.bannedBy, bannedAt = EXCLUDED.bannedAt`,
            [userId, reason ?? null, bannedBy, at],
        );
        return;
    }
    await db.run(
        `INSERT INTO dash_global_member_bans (userId, reason, bannedBy, bannedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET reason = excluded.reason, bannedBy = excluded.bannedBy, bannedAt = excluded.bannedAt`,
        [userId, reason ?? null, bannedBy, at],
    );
}

export async function unbanGlobal(heart: IHeart, userId: string): Promise<void> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_global_member_bans').deleteOne({
            $or: [{ _id: userId }, { userId }],
        });
        return;
    }
    await db.run(`DELETE FROM dash_global_member_bans WHERE userId = ?`, [userId]);
}

export async function getServerPluginConfig(
    heart: IHeart,
    guildId: string,
    pluginId: string,
): Promise<Record<string, unknown>> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        const row = await db.mongoCollection('dash_server_plugin_config').findOne({ guildId, pluginId });
        if (!row) return {};
        const raw = row.config;
        if (typeof raw === 'string') return JSON.parse(raw) as Record<string, unknown>;
        if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
        return {};
    }
    const row = await db.get(
        `SELECT config FROM dash_server_plugin_config WHERE guildId = ? AND pluginId = ?`,
        [guildId, pluginId],
    );
    return row ? (JSON.parse(String(row.config)) as Record<string, unknown>) : {};
}

export async function setServerPluginConfig(
    heart: IHeart,
    guildId: string,
    pluginId: string,
    config: Record<string, unknown>,
): Promise<void> {
    const db = await ensureDashboardAdapter();
    const at = Date.now();
    const payload = JSON.stringify(config);
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_server_plugin_config').updateOne(
            { guildId, pluginId },
            {
                $set: {
                    guildId,
                    pluginId,
                    config: payload,
                    updatedAt: at,
                },
            },
            { upsert: true },
        );
        return;
    }
    if (db.engine === 'postgres') {
        await db.run(
            `INSERT INTO dash_server_plugin_config (guildId, pluginId, config, updatedAt) VALUES (?, ?, ?, ?)
             ON CONFLICT (guildId, pluginId) DO UPDATE SET config = EXCLUDED.config, updatedAt = EXCLUDED.updatedAt`,
            [guildId, pluginId, payload, at],
        );
        return;
    }
    await db.run(
        `INSERT INTO dash_server_plugin_config (guildId, pluginId, config, updatedAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(guildId, pluginId) DO UPDATE SET config = excluded.config, updatedAt = excluded.updatedAt`,
        [guildId, pluginId, payload, at],
    );
}

export async function infractionsCollection(heart: IHeart) {
    return heart.db.nova.get('main').collection('dash_infractions');
}

export async function auditCollection(heart: IHeart) {
    return heart.db.nova.get('main').collection('dash_audit_log');
}

export async function cmdCounterCollection(heart: IHeart) {
    return heart.db.nova.get('main').collection('dash_command_counters');
}

export async function writeAudit(
    heart: IHeart,
    entry: {
        actorId: string;
        action: string;
        target?: string;
        guildId?: string | null;
        meta?: Record<string, unknown>;
    },
): Promise<void> {
    const col = await auditCollection(heart);
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    await col.upsert({
        _id: `log_${entry.guildId ?? 'global'}_${ts}_${rand}`,
        actorId: entry.actorId,
        action: entry.action,
        target: entry.target ?? null,
        guildId: entry.guildId ?? null,
        meta: entry.meta ?? {},
        createdAt: ts,
    });
}

export const GLOBAL_BAN_SENTINEL = 'global';

export function newId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
