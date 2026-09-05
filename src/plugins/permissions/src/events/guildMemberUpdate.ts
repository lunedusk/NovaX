import { BaseEvent } from '#core/bases/Event.js';
import type { GuildMember, PartialGuildMember } from 'discord.js';
import { permissionsManager } from '#core/manager/permissions.js';
import { clientHasGuildMembersIntent } from '#core/manager/permissionRoleLinks.js';

export default class GuildMemberUpdatePermSync extends BaseEvent<
    [GuildMember | PartialGuildMember, GuildMember]
> {
    public readonly name = 'guildMemberUpdate';
    public readonly once = false;

    public async execute(
        _oldMember: GuildMember | PartialGuildMember,
        newMember: GuildMember,
    ): Promise<void> {
        if (!permissionsManager) return;

        if (!clientHasGuildMembersIntent(this.heart.client)) {
            this.heart.log.debug(
                'GuildMembers intent off — skipping Discord role → perm sync on member update',
            );
            return;
        }

        try {
            const guildId = newMember.guild.id;
            const serverLinks = await permissionsManager.listDiscordRoleLinks({
                scope: 'server',
                guildId,
            });
            const botLinks = await permissionsManager.listDiscordRoleLinks({ scope: 'bot' });
            const links = [...serverLinks, ...botLinks];
            if (links.length === 0) return;

            const memberRoleIds = new Set(newMember.roles.cache.keys());
            const userId = newMember.id;

            for (const link of links) {
                const hasDiscord = memberRoleIds.has(link.discordRoleId);
                if (hasDiscord) {
                    await permissionsManager.applyDiscordGrant(
                        link.scope,
                        link.scope === 'bot' ? null : guildId,
                        link.permRoleId,
                        userId,
                        link.discordRoleId,
                    );
                } else {
                    await permissionsManager.revokeDiscordGrantIfOrphan(
                        link.scope,
                        link.scope === 'bot' ? null : guildId,
                        link.permRoleId,
                        userId,
                        link.discordRoleId,
                    );
                }
            }
        } catch (err) {
            this.heart.log.warn(
                `Discord role perm sync soft-failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
