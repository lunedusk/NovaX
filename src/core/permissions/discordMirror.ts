import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';
import type { SqlAdapter } from '#core/database/sqlAdapter.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DiscordMirror');

export const DEFAULT_DISCORD_TO_SERVER_BITS: Readonly<Record<string, string>> = {
    BanMembers: 'server.members.ban',
    KickMembers: 'server.members.kick',
    ModerateMembers: 'server.members.mute',
    ManageNicknames: 'server.members.nick',
    ManageRoles: 'server.roles.manage',
    ManageGuild: 'server.config.manage',
    ViewAuditLog: 'server.logs.view',
    ManageMessages: 'server.members.view',
};

export interface GuildMirrorState {
    readonly guildId: string;
    readonly enabled: boolean;
    readonly map: Readonly<Record<string, string>>;
    readonly updatedAt: number;
    readonly updatedBy: string | null;
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

export async function ensureMirrorSchema(db: SqlAdapter): Promise<void> {
    if (db.engine === 'mongo') return;
    await db.run(
        `CREATE TABLE IF NOT EXISTS perm_guild_mirror (
            guildId TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 0,
            mapJson TEXT,
            updatedAt INTEGER NOT NULL,
            updatedBy TEXT
        )`,
    );
}

export async function getGuildMirror(db: SqlAdapter, guildId: string): Promise<GuildMirrorState> {
    if (db.engine === 'mongo') {
        const row = await db.mongoCollection('perm_guild_mirror').findOne({ guildId });
        if (!row) {
            return {
                guildId,
                enabled: false,
                map: DEFAULT_DISCORD_TO_SERVER_BITS,
                updatedAt: 0,
                updatedBy: null,
            };
        }
        let map = DEFAULT_DISCORD_TO_SERVER_BITS;
        if (row.mapJson) {
            try {
                map = { ...DEFAULT_DISCORD_TO_SERVER_BITS, ...JSON.parse(String(row.mapJson)) };
            } catch {
                log.warn(`Invalid mirror map JSON for guild ${guildId}`);
            }
        }
        return {
            guildId,
            enabled: Boolean(row.enabled),
            map,
            updatedAt: Number(row.updatedAt ?? 0),
            updatedBy: row.updatedBy != null ? String(row.updatedBy) : null,
        };
    }

    const row = await db.get(`SELECT * FROM perm_guild_mirror WHERE guildId = ?`, [guildId]);
    if (!row) {
        return {
            guildId,
            enabled: false,
            map: DEFAULT_DISCORD_TO_SERVER_BITS,
            updatedAt: 0,
            updatedBy: null,
        };
    }
    let map = { ...DEFAULT_DISCORD_TO_SERVER_BITS };
    if (row.mapJson) {
        try {
            map = { ...map, ...JSON.parse(String(row.mapJson)) };
        } catch {
            log.warn(`Invalid mirror map JSON for guild ${guildId}`);
        }
    }
    return {
        guildId,
        enabled: Number(row.enabled) === 1,
        map,
        updatedAt: Number(row.updatedAt),
        updatedBy: row.updatedBy != null ? String(row.updatedBy) : null,
    };
}

export async function setGuildMirror(
    db: SqlAdapter,
    guildId: string,
    input: {
        enabled: boolean;
        map?: Record<string, string> | null;
        updatedBy: string | null;
    },
): Promise<GuildMirrorState> {
    const at = nowSeconds();
    const mapJson = input.map ? JSON.stringify(input.map) : null;
    if (db.engine === 'mongo') {
        await db.mongoCollection('perm_guild_mirror').updateOne(
            { guildId },
            {
                $set: {
                    guildId,
                    enabled: input.enabled ? 1 : 0,
                    mapJson,
                    updatedAt: at,
                    updatedBy: input.updatedBy,
                },
            },
            { upsert: true },
        );
    } else {
        await db.run(
            `INSERT INTO perm_guild_mirror (guildId, enabled, mapJson, updatedAt, updatedBy)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(guildId) DO UPDATE SET
               enabled = excluded.enabled,
               mapJson = excluded.mapJson,
               updatedAt = excluded.updatedAt,
               updatedBy = excluded.updatedBy`,
            [guildId, input.enabled ? 1 : 0, mapJson, at, input.updatedBy],
        );
    }
    return getGuildMirror(db, guildId);
}

export function mirrorDiscordPermissionsToBits(
    permissions: PermissionsBitField | Readonly<{ has: (flag: bigint) => boolean }>,
    map: Readonly<Record<string, string>> = DEFAULT_DISCORD_TO_SERVER_BITS,
): Set<string> {
    const out = new Set<string>();
    for (const [flagName, bit] of Object.entries(map)) {
        const flag = (PermissionFlagsBits as Record<string, bigint | undefined>)[flagName];
        if (flag === undefined) continue;
        try {
            if (permissions.has(flag)) out.add(bit);
        } catch {
            
        }
    }
    return out;
}
