import type { GuildMember } from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import type ModerationHandler from './moderation.js';

export default class MemberActionsHandler extends BaseHandler {
    public readonly name = 'memberActions';
    public readonly description = 'Member lookup and moderation actions via moderation handler';

    private moderation(): ModerationHandler | undefined {
        return this.heart.system.handler.$get('core', 'moderation') as ModerationHandler | undefined;
    }

    public async fetchMember(guildId: string, userId: string): Promise<GuildMember | null> {
        const guild = this.heart.client.guilds.cache.get(guildId);
        if (!guild) return null;
        try {
            return await guild.members.fetch(userId);
        } catch {
            return null;
        }
    }

    public async ban(
        ...args: Parameters<ModerationHandler['ban']>
    ): ReturnType<ModerationHandler['ban']> {
        const m = this.moderation();
        if (!m) throw new Error('moderation handler unavailable');
        return m.ban(...args);
    }

    public async unban(
        ...args: Parameters<ModerationHandler['unban']>
    ): ReturnType<ModerationHandler['unban']> {
        const m = this.moderation();
        if (!m) throw new Error('moderation handler unavailable');
        return m.unban(...args);
    }

    public async kick(
        ...args: Parameters<ModerationHandler['kick']>
    ): ReturnType<ModerationHandler['kick']> {
        const m = this.moderation();
        if (!m) throw new Error('moderation handler unavailable');
        return m.kick(...args);
    }

    public async timeout(
        ...args: Parameters<ModerationHandler['timeout']>
    ): ReturnType<ModerationHandler['timeout']> {
        const m = this.moderation();
        if (!m) throw new Error('moderation handler unavailable');
        return m.timeout(...args);
    }

    public async untimeout(
        ...args: Parameters<ModerationHandler['untimeout']>
    ): ReturnType<ModerationHandler['untimeout']> {
        const m = this.moderation();
        if (!m) throw new Error('moderation handler unavailable');
        return m.untimeout(...args);
    }

    public async addRole(
        ...args: Parameters<ModerationHandler['addRole']>
    ): ReturnType<ModerationHandler['addRole']> {
        const m = this.moderation();
        if (!m) throw new Error('moderation handler unavailable');
        return m.addRole(...args);
    }

    public async removeRole(
        ...args: Parameters<ModerationHandler['removeRole']>
    ): ReturnType<ModerationHandler['removeRole']> {
        const m = this.moderation();
        if (!m) throw new Error('moderation handler unavailable');
        return m.removeRole(...args);
    }

    public async setNick(
        ...args: Parameters<ModerationHandler['setNick']>
    ): ReturnType<ModerationHandler['setNick']> {
        const m = this.moderation();
        if (!m) throw new Error('moderation handler unavailable');
        return m.setNick(...args);
    }

    public async revertNick(
        ...args: Parameters<ModerationHandler['revertNick']>
    ): ReturnType<ModerationHandler['revertNick']> {
        const m = this.moderation();
        if (!m) throw new Error('moderation handler unavailable');
        return m.revertNick(...args);
    }
}
