import {
    ChannelType,
    GatewayIntentBits,
    PermissionFlagsBits,
    PermissionsBitField,
    type Client,
    type Guild,
    type TextChannel,
} from 'discord.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('FeatureRequirements');

export type IntentName = keyof typeof GatewayIntentBits;

export interface FeatureRequirement {
    readonly id: string;
    readonly pluginId: string;
    readonly description?: string;
    readonly intents?: readonly IntentName[];
    readonly permissions?: readonly bigint[];
    readonly softDisabled?: boolean;
}

function intentBit(name: IntentName): number {
    const v = GatewayIntentBits[name];
    return typeof v === 'number' ? v : Number(v);
}

function permissionLabel(bit: bigint): string {
    for (const [name, value] of Object.entries(PermissionFlagsBits)) {
        if (typeof value === 'bigint' && value === bit) return name;
        if (typeof value === 'number' && BigInt(value) === bit) return name;
    }
    return `0x${bit.toString(16)}`;
}

export class FeatureRequirementsRegistry {
    private readonly features = new Map<string, FeatureRequirement>();
    private intentWarned = false;

    public register(feature: FeatureRequirement): void {
        const existing = this.features.get(feature.id);
        if (existing && existing.pluginId !== feature.pluginId) {
            log.debug(
                `Feature requirement "${feature.id}" re-registered by "${feature.pluginId}" (was "${existing.pluginId}").`,
            );
        }
        this.features.set(feature.id, feature);
    }

    public unregister(id: string): boolean {
        return this.features.delete(id);
    }

    public list(): readonly FeatureRequirement[] {
        return [...this.features.values()];
    }

    public get(id: string): FeatureRequirement | undefined {
        return this.features.get(id);
    }

    public clientHasIntent(client: Client, name: IntentName): boolean {
        try {
            const intents = client.options.intents;
            if (intents == null) return false;
            const bit = intentBit(name);
            if (typeof (intents as { has?: (b: number) => boolean }).has === 'function') {
                return (intents as { has: (b: number) => boolean }).has(bit);
            }
            const bitfield = BigInt(String(intents));
            return (bitfield & BigInt(bit)) !== 0n;
        } catch {
            return false;
        }
    }

    public missingIntentsFor(client: Client, feature: FeatureRequirement): IntentName[] {
        if (feature.softDisabled || !feature.intents?.length) return [];
        return feature.intents.filter((name) => !this.clientHasIntent(client, name));
    }

    public warnMissingIntents(client: Client): void {
        if (this.intentWarned) return;
        this.intentWarned = true;

        const lines: string[] = [];
        for (const feature of this.features.values()) {
            if (feature.softDisabled) continue;
            const missing = this.missingIntentsFor(client, feature);
            if (missing.length === 0) continue;
            const label = feature.description ?? feature.id;
            lines.push(`  - ${label} (${feature.id}) requires intents: ${missing.join(', ')}`);
        }

        if (lines.length === 0) return;

        log.warn(
            `These features will not work as intended due to missing privileged/gateway intents:\n${lines.join('\n')}`,
        );
    }

    public missingPermissionsFor(
        me: { permissions: PermissionsBitField },
        feature: FeatureRequirement,
    ): bigint[] {
        if (feature.softDisabled || !feature.permissions?.length) return [];
        return feature.permissions.filter((bit) => !me.permissions.has(bit));
    }

    public async notifyGuildOwnerOnJoin(guild: Guild): Promise<void> {
        const me = guild.members.me;
        if (!me) return;

        const issues: Array<{ feature: FeatureRequirement; missing: bigint[] }> = [];
        for (const feature of this.features.values()) {
            if (feature.softDisabled) continue;
            if (!feature.permissions?.length) continue;
            const missing = this.missingPermissionsFor(me, feature);
            if (missing.length === 0) continue;
            issues.push({ feature, missing });
        }
        if (issues.length === 0) return;

        const body = this.formatPermissionWarning(guild, issues);
        const owner = await guild.fetchOwner().catch(() => null);

        if (owner) {
            try {
                await owner.send({ content: body });
                log.info(`Feature permission warning DM sent to owner of guild ${guild.id}`);
                return;
            } catch {
                /* DMs closed */
            }
        }

        const channel = await this.findAnnounceChannel(guild);
        if (!channel) {
            log.debug(`Feature permission warning: no channel to message in guild ${guild.id}`);
            return;
        }

        const ownerMention = owner ? `<@${owner.id}>` : guild.ownerId ? `<@${guild.ownerId}>` : 'server owner';
        try {
            await channel.send({ content: `${ownerMention}\n${body}` });
            log.info(`Feature permission warning posted in #${channel.name} (${guild.id})`);
        } catch (err) {
            log.debug(
                `Feature permission warning failed in guild ${guild.id}: ${(err as Error).message}`,
            );
        }
    }

    private formatPermissionWarning(
        guild: Guild,
        issues: Array<{ feature: FeatureRequirement; missing: bigint[] }>,
    ): string {
        const lines: string[] = [
            `**${guild.client.user?.username ?? 'Bot'}** joined **${guild.name}** but is missing Discord permissions for some features:`,
            '',
        ];
        for (const { feature, missing } of issues) {
            const label = feature.description ?? feature.id;
            const perms = missing.map(permissionLabel).join(', ');
            lines.push(`• **${label}** needs: ${perms}`);
        }
        lines.push('');
        lines.push(
            'Those features may not work as intended until the bot role is granted the listed permissions.',
        );
        lines.push('Granting **Administrator** to the bot role is the simplest way to fix all of them.');
        return lines.join('\n');
    }

    private async findAnnounceChannel(guild: Guild): Promise<TextChannel | null> {
        const me = guild.members.me;
        if (!me) return null;

        const canSend = (ch: TextChannel): boolean => {
            try {
                return ch.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages) === true;
            } catch {
                return false;
            }
        };

        const textChannels = guild.channels.cache.filter(
            (c): c is TextChannel => c.type === ChannelType.GuildText && canSend(c as TextChannel),
        );

        const staff = textChannels.find((ch) => {
            const overwrites = ch.permissionOverwrites.cache;
            const everyone = overwrites.get(guild.id);
            const denyView =
                everyone?.deny?.has?.(PermissionFlagsBits.ViewChannel) === true ||
                everyone?.deny?.has?.(PermissionFlagsBits.SendMessages) === true;
            return denyView;
        });
        if (staff) return staff;

        const named = textChannels.find((ch) =>
            /mod|admin|staff|log|operator/i.test(ch.name),
        );
        if (named) return named;

        const sorted = [...textChannels.values()].sort(
            (a, b) => (a.position ?? 0) - (b.position ?? 0),
        );
        return sorted[0] ?? null;
    }
}

export const featureRequirements = new FeatureRequirementsRegistry();

export function registerCoreFeatureRequirements(): void {
    featureRequirements.register({
        id: 'core.guildAccess.ownerAuthorize',
        pluginId: 'core',
        description: 'Owner-authorize on bot invite (audit log)',
        permissions: [PermissionFlagsBits.ViewAuditLog],
    });
    featureRequirements.register({
        id: 'core.guildAccess.leavePolicy',
        pluginId: 'core',
        description: 'Guild leave blacklist/whitelist enforcement',
        permissions: [],
    });
    featureRequirements.register({
        id: 'core.guildGate',
        pluginId: 'core',
        description: 'Guild / plugin soft gate checks',
        permissions: [],
    });
    featureRequirements.register({
        id: 'core.moderation.ban',
        pluginId: 'core',
        description: 'Ban / unban members',
        permissions: [PermissionFlagsBits.BanMembers],
    });
    featureRequirements.register({
        id: 'core.moderation.kick',
        pluginId: 'core',
        description: 'Kick members',
        permissions: [PermissionFlagsBits.KickMembers],
    });
    featureRequirements.register({
        id: 'core.moderation.timeout',
        pluginId: 'core',
        description: 'Timeout members',
        permissions: [PermissionFlagsBits.ModerateMembers],
    });
    featureRequirements.register({
        id: 'core.moderation.roles',
        pluginId: 'core',
        description: 'Add / remove roles',
        permissions: [PermissionFlagsBits.ManageRoles],
    });
    featureRequirements.register({
        id: 'core.moderation.nick',
        pluginId: 'core',
        description: 'Change / revert nicknames',
        permissions: [PermissionFlagsBits.ManageNicknames],
    });
    featureRequirements.register({
        id: 'core.handlers.channelActions',
        pluginId: 'core',
        description: 'Channel lock / unlock (SendMessages overwrites)',
        permissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
    });
    featureRequirements.register({
        id: 'core.handlers.messageActions',
        pluginId: 'core',
        description: 'Message send / delete / purge',
        permissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages],
        intents: ['Guilds', 'GuildMessages'],
    });
    featureRequirements.register({
        id: 'core.handlers.voiceActions',
        pluginId: 'core',
        description: 'Voice mute / deafen / move',
        permissions: [PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers],
        intents: ['GuildVoiceStates'],
    });
    featureRequirements.register({
        id: 'core.handlers.emojiActions',
        pluginId: 'core',
        description: 'Guild emoji listing / management',
        permissions: [PermissionFlagsBits.ManageGuildExpressions],
        intents: ['Guilds'],
    });
    featureRequirements.register({
        id: 'core.handlers.guildActions',
        pluginId: 'core',
        description: 'Guild settings / invites / metadata',
        permissions: [PermissionFlagsBits.ManageGuild],
        intents: ['Guilds'],
    });
    featureRequirements.register({
        id: 'core.handlers.memberActions',
        pluginId: 'core',
        description: 'Member resolve and member-scoped actions',
        intents: ['GuildMembers'],
        permissions: [PermissionFlagsBits.ViewChannel],
    });
    featureRequirements.register({
        id: 'core.handlers.announce',
        pluginId: 'core',
        description: 'Announce / broadcast messages',
        permissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.MentionEveryone],
    });
    featureRequirements.register({
        id: 'core.presence',
        pluginId: 'core',
        description: 'Presence / activity rotation',
        permissions: [],
    });
    featureRequirements.register({
        id: 'core.commands.admin',
        pluginId: 'core',
        description: 'Admin slash surface (metrics, gate, access, fleet)',
        permissions: [],
    });
}

export function registerPermissionsFeatureRequirements(): void {
    featureRequirements.register({
        id: 'permissions.discordRoleSync',
        pluginId: 'permissions',
        description: 'Discord role → permission bit sync',
        intents: ['GuildMembers'],
        permissions: [PermissionFlagsBits.ViewChannel],
    });
    featureRequirements.register({
        id: 'permissions.hierarchy',
        pluginId: 'permissions',
        description: 'Permission hierarchy checks',
        permissions: [],
    });
    featureRequirements.register({
        id: 'permissions.mirror',
        pluginId: 'permissions',
        description: 'Per-guild Discord permission mirror',
        intents: ['GuildMembers'],
        permissions: [PermissionFlagsBits.ViewChannel],
    });
}

export function registerApiFeatureRequirements(): void {
    featureRequirements.register({
        id: 'api.gateway',
        pluginId: 'api',
        description: 'HTTP API gateway (no Discord guild perms)',
        permissions: [],
    });
}

export function registerTokenFeatureRequirements(): void {
    featureRequirements.register({
        id: 'token.manager',
        pluginId: 'token',
        description: 'API token issue / rotate / revoke',
        permissions: [],
    });
}

export function registerDashboardFeatureRequirements(): void {
    featureRequirements.register({
        id: 'dashboard.http',
        pluginId: 'dashboard',
        description: 'Dashboard admin HTTP routes',
        permissions: [],
    });
    featureRequirements.register({
        id: 'dashboard.discordOAuth',
        pluginId: 'dashboard',
        description: 'Dashboard Discord identity',
        intents: ['Guilds'],
        permissions: [],
    });
}

export function registerDashDataFeatureRequirements(): void {
    featureRequirements.register({
        id: 'dash-data.store',
        pluginId: 'dash-data',
        description: 'Dashboard data store',
        permissions: [],
    });
}

export function registerAllBuiltinFeatureRequirements(): void {
    registerCoreFeatureRequirements();
    registerPermissionsFeatureRequirements();
    registerApiFeatureRequirements();
    registerTokenFeatureRequirements();
    registerDashboardFeatureRequirements();
    registerDashDataFeatureRequirements();
}
