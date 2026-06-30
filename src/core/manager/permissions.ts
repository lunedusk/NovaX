import { randomUUID } from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import {
    PermissionError,
    BUILT_IN_BITS,
    type PermBitDoc,
    type BotWideRoleDoc,
    type ServerRoleDoc,
    type ResolvedPermissions,
    type PermissionCheckResult,
    type CreateBotRoleInput,
    type CreateServerRoleInput,
} from '#core/types/permissions.js';
import { PermissionsBitField, type Interaction } from 'discord.js';
import type { PermissionCache } from '#core/manager/permissionCache.js';
import { sqliteDB } from '#core/database/sqlite.js';

const log = getLogger('PermissionsManager');
interface SqliteDb {
    prepare(sql: string): {
        run: (...params: unknown[]) => unknown;
        get: (...params: unknown[]) => any;
        all: (...params: unknown[]) => any[];
    };
    exec(sql: string): void;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
}

const ALL_BOT_BITS = BUILT_IN_BITS.filter(b => b.scope === 'bot').map(b => b.bit);

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function parseJsonArray(value: unknown): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

export interface RouteAccessConfig {
    permissionLevel?: string;
    roleIds?: string[];
    userIds?: string[];
    userPermissions?: import('discord.js').PermissionResolvable[];
    clientPermissions?: import('discord.js').PermissionResolvable[];
    allowInDm?: boolean;
    denyMessage?: string;
}


export class PermissionsManager {
    private readonly dbAlias = 'main';
    private db!: SqliteDb;
    private cache?: PermissionCache;

    constructor() {}

    public setCache(cache: PermissionCache): void {
        this.cache = cache;
    }

    public async init(): Promise<void> {
        this.db = sqliteDB.get(this.dbAlias) as unknown as SqliteDb;

        this.db.exec(`
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
        `);

        const insertBit = this.db.prepare(`
            INSERT INTO perm_bits (id, description, scope, pluginId, builtIn, createdAt)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(id) DO UPDATE SET description = excluded.description, scope = excluded.scope
        `);

        const seed = this.db.transaction((bits: typeof BUILT_IN_BITS) => {
            for (const b of bits) {
                insertBit.run(b.bit, b.description, b.scope, null, nowSeconds());
            }
        });
        seed(BUILT_IN_BITS);

        log.info('PermissionsManager initialized (sqlite backend, alias=' + this.dbAlias + ').');
    }
    public applyCommandDefaults(data: any, config: any): void {
        if (!config) return;

        if (config.userPermissions && config.userPermissions.length > 0) {
            const bits = new PermissionsBitField(config.userPermissions);
            data.setDefaultMemberPermissions(bits.bitfield);
        }

        if (typeof config.allowInDm === 'boolean') {
            data.setDMPermission(config.allowInDm);
        }
    }


    public async registerBit(bit: string, description: string, pluginId?: string): Promise<void> {
        const scope: PermBitDoc['scope'] = bit.startsWith('bot.')
            ? 'bot'
            : bit.startsWith('server.')
                ? 'server'
                : 'plugin';

        this.db.prepare(`
            INSERT INTO perm_bits (id, description, scope, pluginId, builtIn, createdAt)
            VALUES (?, ?, ?, ?, 0, ?)
            ON CONFLICT(id) DO UPDATE SET description = excluded.description
        `).run(bit, description, scope, pluginId ?? null, nowSeconds());
    }

    public async listBits(scope?: 'bot' | 'server' | 'plugin'): Promise<PermBitDoc[]> {
        const rows = scope
            ? this.db.prepare(`SELECT * FROM perm_bits WHERE scope = ? ORDER BY id`).all(scope)
            : this.db.prepare(`SELECT * FROM perm_bits ORDER BY id`).all();

        return rows.map((r: any) => ({
            _id: r.id,
            description: r.description,
            scope: r.scope,
            pluginId: r.pluginId ?? undefined,
            builtIn: !!r.builtIn,
            createdAt: r.createdAt,
        }));
    }

    private async bitsExist(bits: string[]): Promise<boolean> {
        if (bits.length === 0) return true;
        const placeholders = bits.map(() => '?').join(',');
        const row = this.db
            .prepare(`SELECT COUNT(*) AS cnt FROM perm_bits WHERE id IN (${placeholders})`)
            .get(...bits);
        return row.cnt === bits.length;
    }

    public async createBotRole(data: CreateBotRoleInput): Promise<BotWideRoleDoc> {
        if (!(await this.bitsExist(data.bits))) {
            throw new PermissionError('INVALID_BIT', 'One or more bits do not exist in the catalogue.');
        }

        const doc: BotWideRoleDoc = {
            _id: `bwrole_${randomUUID()}`,
            name: data.name,
            color: data.color,
            bits: data.bits,
            assignedUserIds: [],
            createdAt: nowSeconds(),
            createdBy: data.createdBy,
            updatedAt: nowSeconds(),
        };

        this.db.prepare(`
            INSERT INTO perm_bwroles (id, name, color, bits, assignedUserIds, createdAt, createdBy, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(doc._id, doc.name, doc.color, JSON.stringify(doc.bits), JSON.stringify(doc.assignedUserIds), doc.createdAt, doc.createdBy, doc.updatedAt);

        return doc;
    }

    public async updateBotRole(roleId: string, data: Partial<CreateBotRoleInput>): Promise<BotWideRoleDoc> {
        const existing = await this.getBotRole(roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Bot role ${roleId} not found.`);

        if (data.bits && !(await this.bitsExist(data.bits))) {
            throw new PermissionError('INVALID_BIT', 'One or more bits do not exist in the catalogue.');
        }

        const updated: BotWideRoleDoc = {
            ...existing,
            ...data,
            bits: data.bits ?? existing.bits,
            updatedAt: nowSeconds(),
        };

        this.db.prepare(`
            UPDATE perm_bwroles SET name = ?, color = ?, bits = ?, updatedAt = ?
            WHERE id = ?
        `).run(updated.name, updated.color, JSON.stringify(updated.bits), updated.updatedAt, roleId);

        return updated;
    }

    public async deleteBotRole(roleId: string): Promise<void> {
        const existing = await this.getBotRole(roleId);
        this.db.prepare(`DELETE FROM perm_bwroles WHERE id = ?`).run(roleId);
        if (existing) {
            await Promise.all(existing.assignedUserIds.map(uid => this.invalidateUserCache(uid)));
        }
    }

    private async getBotRole(roleId: string): Promise<BotWideRoleDoc | null> {
        const row = this.db.prepare(`SELECT * FROM perm_bwroles WHERE id = ?`).get(roleId);
        if (!row) return null;
        return this.rowToBotRole(row);
    }

    public async listBotRoles(): Promise<BotWideRoleDoc[]> {
        const rows = this.db.prepare(`SELECT * FROM perm_bwroles ORDER BY createdAt`).all();
        return rows.map((r: any) => this.rowToBotRole(r));
    }

    public async assignBotRole(roleId: string, userIds: string[]): Promise<void> {
        const existing = await this.getBotRole(roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Bot role ${roleId} not found.`);

        const merged = Array.from(new Set([...existing.assignedUserIds, ...userIds]));
        this.db.prepare(`UPDATE perm_bwroles SET assignedUserIds = ?, updatedAt = ? WHERE id = ?`)
            .run(JSON.stringify(merged), nowSeconds(), roleId);

        await Promise.all(userIds.map(uid => this.invalidateUserCache(uid)));
    }

    public async revokeBotRole(roleId: string, userIds: string[]): Promise<void> {
        const existing = await this.getBotRole(roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Bot role ${roleId} not found.`);

        const remaining = existing.assignedUserIds.filter(uid => !userIds.includes(uid));
        this.db.prepare(`UPDATE perm_bwroles SET assignedUserIds = ?, updatedAt = ? WHERE id = ?`)
            .run(JSON.stringify(remaining), nowSeconds(), roleId);

        await Promise.all(userIds.map(uid => this.invalidateUserCache(uid)));
    }

    private rowToBotRole(r: any): BotWideRoleDoc {
        return {
            _id: r.id,
            name: r.name,
            color: r.color,
            bits: parseJsonArray(r.bits),
            assignedUserIds: parseJsonArray(r.assignedUserIds),
            createdAt: r.createdAt,
            createdBy: r.createdBy,
            updatedAt: r.updatedAt,
        };
    }

    private assertServerScopedBits(bits: string[]): void {
        const offender = bits.find(b => !(b.startsWith('server.') || b.startsWith('plugin.')));
        if (offender) {
            throw new PermissionError(
                'INVALID_SCOPE',
                `Server roles cannot contain bot-scoped bit "${offender}".`
            );
        }
    }

    public async createServerRole(guildId: string, data: CreateServerRoleInput): Promise<ServerRoleDoc> {
        this.assertServerScopedBits(data.bits);
        if (!(await this.bitsExist(data.bits))) {
            throw new PermissionError('INVALID_BIT', 'One or more bits do not exist in the catalogue.');
        }

        const doc: ServerRoleDoc = {
            _id: `srole_${guildId}_${randomUUID()}`,
            guildId,
            name: data.name,
            color: data.color,
            bits: data.bits,
            assignedUserIds: [],
            createdAt: nowSeconds(),
            createdBy: data.createdBy,
            updatedAt: nowSeconds(),
        };

        this.db.prepare(`
            INSERT INTO perm_sroles (id, guildId, name, color, bits, assignedUserIds, createdAt, createdBy, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(doc._id, doc.guildId, doc.name, doc.color, JSON.stringify(doc.bits), JSON.stringify(doc.assignedUserIds), doc.createdAt, doc.createdBy, doc.updatedAt);

        return doc;
    }

    public async updateServerRole(guildId: string, roleId: string, data: Partial<CreateServerRoleInput>): Promise<ServerRoleDoc> {
        const existing = await this.getServerRole(guildId, roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Server role ${roleId} not found.`);

        if (data.bits) {
            this.assertServerScopedBits(data.bits);
            if (!(await this.bitsExist(data.bits))) {
                throw new PermissionError('INVALID_BIT', 'One or more bits do not exist in the catalogue.');
            }
        }

        const updated: ServerRoleDoc = {
            ...existing,
            ...data,
            bits: data.bits ?? existing.bits,
            updatedAt: nowSeconds(),
        };

        this.db.prepare(`
            UPDATE perm_sroles SET name = ?, color = ?, bits = ?, updatedAt = ?
            WHERE id = ? AND guildId = ?
        `).run(updated.name, updated.color, JSON.stringify(updated.bits), updated.updatedAt, roleId, guildId);

        return updated;
    }

    public async deleteServerRole(guildId: string, roleId: string): Promise<void> {
        const existing = await this.getServerRole(guildId, roleId);
        this.db.prepare(`DELETE FROM perm_sroles WHERE id = ? AND guildId = ?`).run(roleId, guildId);
        if (existing) {
            await Promise.all(existing.assignedUserIds.map(uid => this.invalidateUserCache(uid, guildId)));
        }
    }

    private async getServerRole(guildId: string, roleId: string): Promise<ServerRoleDoc | null> {
        const row = this.db.prepare(`SELECT * FROM perm_sroles WHERE id = ? AND guildId = ?`).get(roleId, guildId);
        if (!row) return null;
        return this.rowToServerRole(row);
    }

    public async listServerRoles(guildId: string): Promise<ServerRoleDoc[]> {
        const rows = this.db.prepare(`SELECT * FROM perm_sroles WHERE guildId = ? ORDER BY createdAt`).all(guildId);
        return rows.map((r: any) => this.rowToServerRole(r));
    }

    public async assignServerRole(guildId: string, roleId: string, userIds: string[]): Promise<void> {
        const existing = await this.getServerRole(guildId, roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Server role ${roleId} not found.`);

        const merged = Array.from(new Set([...existing.assignedUserIds, ...userIds]));
        this.db.prepare(`UPDATE perm_sroles SET assignedUserIds = ?, updatedAt = ? WHERE id = ? AND guildId = ?`)
            .run(JSON.stringify(merged), nowSeconds(), roleId, guildId);

        await Promise.all(userIds.map(uid => this.invalidateUserCache(uid, guildId)));
    }

    public async revokeServerRole(guildId: string, roleId: string, userIds: string[]): Promise<void> {
        const existing = await this.getServerRole(guildId, roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Server role ${roleId} not found.`);

        const remaining = existing.assignedUserIds.filter(uid => !userIds.includes(uid));
        this.db.prepare(`UPDATE perm_sroles SET assignedUserIds = ?, updatedAt = ? WHERE id = ? AND guildId = ?`)
            .run(JSON.stringify(remaining), nowSeconds(), roleId, guildId);

        await Promise.all(userIds.map(uid => this.invalidateUserCache(uid, guildId)));
    }

    private rowToServerRole(r: any): ServerRoleDoc {
        return {
            _id: r.id,
            guildId: r.guildId,
            name: r.name,
            color: r.color,
            bits: parseJsonArray(r.bits),
            assignedUserIds: parseJsonArray(r.assignedUserIds),
            createdAt: r.createdAt,
            createdBy: r.createdBy,
            updatedAt: r.updatedAt,
        };
    }

    public async resolve(userId: string, guildId?: string, discordGuildOwnerId?: string): Promise<ResolvedPermissions> {
        const ownerIdsRaw = secrets.getOptional('BotOwnerIds', '') ?? '';
        const ownerIds = ownerIdsRaw.split(',').map(s => s.trim()).filter(Boolean);

        if (ownerIds.includes(userId)) {
            return {
                botOwner: true,
                bits: new Set(ALL_BOT_BITS),
                guildId,
                resolvedAt: nowSeconds(),
            };
        }

        const effectiveBits = new Set<string>();

        const botRoleRows = this.db.prepare(
            `SELECT bits, assignedUserIds FROM perm_bwroles`
        ).all();
        for (const row of botRoleRows) {
            const assigned = parseJsonArray(row.assignedUserIds);
            if (assigned.includes(userId)) {
                for (const bit of parseJsonArray(row.bits)) effectiveBits.add(bit);
            }
        }

        if (guildId) {
            if (discordGuildOwnerId && discordGuildOwnerId === userId) {
                effectiveBits.add('server.owner');
            }

            const serverRoleRows = this.db.prepare(
                `SELECT bits, assignedUserIds FROM perm_sroles WHERE guildId = ?`
            ).all(guildId);
            for (const row of serverRoleRows) {
                const assigned = parseJsonArray(row.assignedUserIds);
                if (assigned.includes(userId)) {
                    for (const bit of parseJsonArray(row.bits)) effectiveBits.add(bit);
                }
            }
        }

        return {
            botOwner: false,
            bits: effectiveBits,
            guildId,
            resolvedAt: nowSeconds(),
        };
    }

    public async cachedResolve(userId: string, guildId?: string, discordGuildOwnerId?: string): Promise<ResolvedPermissions> {
        if (this.cache) {
            return this.cache.cachedResolve(userId, guildId, discordGuildOwnerId);
        }
        return this.resolve(userId, guildId, discordGuildOwnerId);
    }

    public async hasBit(userId: string, bit: string, guildId?: string): Promise<boolean> {
        const resolved = await this.cachedResolve(userId, guildId);
        return resolved.botOwner || resolved.bits.has(bit);
    }

    public async hasAllBits(userId: string, bits: string[], guildId?: string): Promise<boolean> {
        const resolved = await this.cachedResolve(userId, guildId);
        if (resolved.botOwner) return true;
        return bits.every(b => resolved.bits.has(b));
    }

    public async hasAnyBit(userId: string, bits: string[], guildId?: string): Promise<boolean> {
        const resolved = await this.cachedResolve(userId, guildId);
        if (resolved.botOwner) return true;
        return bits.some(b => resolved.bits.has(b));
    }

    public async requireBit(userId: string, bit: string, guildId?: string): Promise<void> {
        if (!(await this.hasBit(userId, bit, guildId))) {
            throw new PermissionError('MISSING_BIT', `User ${userId} is missing required bit "${bit}".`);
        }
    }

        public async canExecute(interaction: Interaction, access?: any): Promise<PermissionCheckResult> {
            if (!access) {
                return { allowed: true, reason: '', ephemeral: false };
            }

            try {
                const userId = interaction.user.id;
                const guildId = interaction.guildId ?? undefined;
                const discordGuildOwnerId = interaction.guild?.ownerId;
                const resolved = await this.cachedResolve(userId, guildId, discordGuildOwnerId);

                if (resolved.botOwner) {
                    return { allowed: true, reason: '', ephemeral: false };
                }

                const denyMsg = access.denyMessage ?? 'You do not have permission to do this.';

                if (access.devOnly) {
                    return { allowed: false, reason: denyMsg, ephemeral: true };
                }

                if (access.userIds && access.userIds.length > 0) {
                    if (!access.userIds.includes(userId)) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }

                const needsGuild = (access.roleIds?.length > 0)
                    || (access.userPermissions?.length > 0)
                    || (access.clientPermissions?.length > 0)
                    || access.serverBit;

                if (!guildId) {
                    const allowDm = access.allowInDm ?? !needsGuild;
                    if (!allowDm) {
                        return {
                            allowed: false,
                            reason: access.denyMessage ?? 'This action is not available in DMs.',
                            ephemeral: true,
                        };
                    }
                }

                if (guildId && access.roleIds && access.roleIds.length > 0) {
                    const member = interaction.guild?.members?.cache.get(userId)
                        ?? (interaction as any).member;

                    if (member) {
                        const memberRoles: string[] = member.roles?.cache
                            ? Array.from(member.roles.cache.keys())
                            : (Array.isArray(member.roles) ? member.roles : []);

                        const hasRole = access.roleIds.some((rid: string) => memberRoles.includes(rid));
                        if (!hasRole) {
                            return { allowed: false, reason: denyMsg, ephemeral: true };
                        }
                    }
                }

                if (guildId && access.userPermissions && access.userPermissions.length > 0) {
                    const memberPerms = (interaction as any).memberPermissions as Readonly<PermissionsBitField> | null;
                    if (memberPerms) {
                        const required = new PermissionsBitField(access.userPermissions);
                        if (!memberPerms.has(required)) {
                            return { allowed: false, reason: denyMsg, ephemeral: true };
                        }
                    }
                }

                if (guildId && access.clientPermissions && access.clientPermissions.length > 0) {
                    const appPerms = (interaction as any).appPermissions as Readonly<PermissionsBitField> | null;
                    if (appPerms) {
                        const required = new PermissionsBitField(access.clientPermissions);
                        if (!appPerms.has(required)) {
                            return {
                                allowed: false,
                                reason: 'I lack the required permissions to execute this action.',
                                ephemeral: true,
                            };
                        }
                    }
                }

                if (access.permissionLevel) {
                    const levelAllowed = await this.checkPermissionLevel(
                        access.permissionLevel, userId, interaction
                    );
                    if (!levelAllowed.allowed) {
                        return levelAllowed;
                    }
                }

                if (access.serverBit) {
                    const bits = Array.isArray(access.serverBit) ? access.serverBit : [access.serverBit];
                    const hasBits = bits.every((b: string) => resolved.bits.has(b));
                    if (!hasBits) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }

                if (access.require) {
                    let requirePassed: boolean;
                    if (typeof access.require === 'function') {
                        requirePassed = access.require(resolved);
                    } else {
                        const bits = Array.isArray(access.require) ? access.require : [access.require];
                        requirePassed = bits.every((b: string) => resolved.bits.has(b));
                    }
                    if (!requirePassed) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }

                return { allowed: true, reason: '', ephemeral: false };
            } catch (err) {
                log.error(`canExecute failed: ${(err as Error).message}`);
                return { allowed: false, reason: 'An internal permission error occurred.', ephemeral: true };
            }
        }

        private async checkPermissionLevel(
            levelName: string,
            userId: string,
            interaction: Interaction
        ): Promise<PermissionCheckResult> {
            const { configManager } = await import('#core/manager/config.js');
            const permConfig = configManager.get<any>('permissions');

            if (!permConfig?.enabled) {
                return { allowed: true, reason: '', ephemeral: false };
            }

            const level = permConfig.levels?.[levelName];
            if (!level) {
                if (levelName === 'public' || levelName === (permConfig.defaultLevel ?? 'public')) {
                    return { allowed: true, reason: '', ephemeral: false };
                }
                log.warn(`Permission level "${levelName}" not found in permissions.json5.`);
                return { allowed: false, reason: `Permission level "${levelName}" is not configured.`, ephemeral: true };
            }

            const denyMsg = level.denyMessage ?? `You do not have the "${levelName}" permission level.`;
            const guildId = interaction.guildId ?? undefined;

            if (level.roleIds && level.roleIds.length > 0 && guildId) {
                const member = interaction.guild?.members?.cache.get(userId)
                    ?? (interaction as any).member;

                if (member) {
                    const memberRoles: string[] = member.roles?.cache
                        ? Array.from(member.roles.cache.keys())
                        : (Array.isArray(member.roles) ? member.roles : []);

                    const hasRole = level.roleIds.some((rid: string) => memberRoles.includes(rid));
                    if (!hasRole) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }
            }

            if (level.discordPermissions && level.discordPermissions.length > 0 && guildId) {
                const memberPerms = (interaction as any).memberPermissions as Readonly<PermissionsBitField> | null;
                if (memberPerms) {
                    const required = new PermissionsBitField(level.discordPermissions);
                    if (!memberPerms.has(required)) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }
            }

            return { allowed: true, reason: '', ephemeral: false };
        }

    public async sendDenied(interaction: Interaction, reason: string): Promise<void> {
        if (!interaction.isRepliable()) return;

        const payload = {
            content: `%%emoji_cross%% ${reason}`,
            ephemeral: true,
        };

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(payload);
            } else {
                await interaction.reply(payload);
            }
        } catch (err) {
            log.error(`sendDenied failed: ${(err as Error).message}`);
        }
    }

    public async invalidateUserCache(userId: string, guildId?: string): Promise<void> {
        if (this.cache) {
            await this.cache.invalidate(userId, guildId);
        }
    }

    public async invalidateGuildCache(guildId: string): Promise<void> {
        if (this.cache) {
            await this.cache.invalidateGuild(guildId);
        }
    }
}

export let permissionsManager: PermissionsManager | undefined;

export function createPermissionsManager(): PermissionsManager {
    permissionsManager = new PermissionsManager();
    return permissionsManager;
}
