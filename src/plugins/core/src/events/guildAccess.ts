import { BaseEvent } from '#core/bases/Event.js';
import { AuditLogEvent, type Guild } from 'discord.js';
import { guildAccess } from '#core/manager/guildAccess.js';
import { secrets } from '#core/helpers/secretManager.js';
import { permissionsManager } from '#core/manager/permissions.js';
import { BOT_OWNER_BIT } from '../lib/bits.js';
import { featureRequirements } from '#core/manager/featureRequirements.js';

export default class GuildAccessEvent extends BaseEvent<[Guild]> {
    public readonly name = 'guildCreate';
    public readonly once = false;

    public async execute(guild: Guild): Promise<void> {
        if (!guildAccess.isReady()) return;

        const policy = guildAccess.getPolicy();
        if (!policy.enabled) return;

        await this.tryOwnerAuthorize(guild);

        try {
            await featureRequirements.notifyGuildOwnerOnJoin(guild);
        } catch (err) {
            this.heart.log.debug(`FeatureRequirements notify failed: ${(err as Error).message}`);
        }

        if (!policy.leaveOnJoin) return;
        if (guildAccess.isGuildAllowed(guild.id)) return;

        try {
            this.heart.log.warn(
                `GuildAccess leaving guild ${guild.id} (${guild.name}) on join: ${policy.leaveReason}`,
            );
            await guild.leave();
        } catch (err) {
            this.heart.log.error(
                `GuildAccess failed to leave ${guild.id}: ${(err as Error).message}`,
            );
        }
    }

    private async tryOwnerAuthorize(guild: Guild): Promise<void> {
        const policy = guildAccess.getPolicy();
        if (!policy.allowOwner) return;

        try {
            const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 6 });
            const me = guild.client.user?.id;
            for (const entry of logs.entries.values()) {
                if (me && entry.target?.id !== me) continue;
                const executorId = entry.executor?.id;
                if (!executorId) continue;
                if (await this.isOwnerActor(executorId)) {
                    await guildAccess.authorizeOwnerGuild(guild.id, executorId);
                    this.heart.log.info(
                        `GuildAccess owner-authorized guild ${guild.id} by ${executorId}`,
                    );
                    return;
                }
            }
        } catch {
            
        }
    }

    private async isOwnerActor(userId: string): Promise<boolean> {
        const raw = secrets.getOptional('BotOwnerIds', '') ?? '';
        const envOwners = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
        if (envOwners.includes(userId)) return true;
        if (!permissionsManager) return false;
        try {
            return await permissionsManager.hasBit(userId, BOT_OWNER_BIT);
        } catch {
            return false;
        }
    }
}
