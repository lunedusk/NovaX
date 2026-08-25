import { type IHeart } from '#core/heart/index.js';
import { type Guild, type GuildMember } from 'discord.js';
import { HttpError } from './http.js';

export function getGuild(heart: IHeart, guildId: string): Guild {
    const guild = heart.client.guilds.cache.get(guildId);
    if (!guild) throw new HttpError(404, 'not_found', `Bot is not in guild ${guildId}, or it does not exist.`);
    return guild;
}

export async function getMember(heart: IHeart, guildId: string, userId: string): Promise<GuildMember> {
    const guild = getGuild(heart, guildId);
    try {
        return await guild.members.fetch(userId);
    } catch {
        throw new HttpError(404, 'not_found', `User ${userId} is not a member of guild ${guildId}.`);
    }
}

export async function kickMember(heart: IHeart, guildId: string, userId: string, reason?: string): Promise<void> {
    const member = await getMember(heart, guildId, userId);
    if (!member.kickable) {
        throw new HttpError(403, 'not_kickable', `The bot lacks permission to kick ${userId} in ${guildId}.`);
    }
    await member.kick(reason);
}

export async function banMember(
    heart: IHeart,
    guildId: string,
    userId: string,
    reason?: string,
    deleteMessageSeconds = 0,
): Promise<void> {
    const guild = getGuild(heart, guildId);
    await guild.bans.create(userId, { reason, deleteMessageSeconds });
}

export async function unbanMember(heart: IHeart, guildId: string, userId: string): Promise<void> {
    const guild = getGuild(heart, guildId);
    await guild.bans.remove(userId).catch(() => {
    });
}

export async function muteMember(
    heart: IHeart,
    guildId: string,
    userId: string,
    durationMs: number,
    reason?: string,
): Promise<void> {
    const member = await getMember(heart, guildId, userId);
    if (!member.moderatable) {
        throw new HttpError(403, 'not_moderatable', `The bot lacks permission to timeout ${userId} in ${guildId}.`);
    }
    await member.timeout(durationMs, reason);
}

export async function unmuteMember(heart: IHeart, guildId: string, userId: string): Promise<void> {
    const member = await getMember(heart, guildId, userId);
    await member.timeout(null);
}

export async function leaveGuild(heart: IHeart, guildId: string): Promise<void> {
    const guild = getGuild(heart, guildId);
    await guild.leave();
}

export function serializeGuild(guild: Guild) {
    return {
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconURL({ size: 256 }) ?? null,
        memberCount: guild.memberCount,
        ownerId: guild.ownerId,
        joinedAt: guild.joinedTimestamp,
    };
}

export function serializeMember(member: GuildMember) {
    return {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        avatarUrl: member.displayAvatarURL({ size: 256 }),
        joinedAt: member.joinedTimestamp,
        roles: member.roles.cache.map((r) => r.id),
        isTimedOut: member.isCommunicationDisabled(),
        communicationDisabledUntil: member.communicationDisabledUntilTimestamp ?? null,
    };
}
