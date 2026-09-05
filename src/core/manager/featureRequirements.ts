import {
    ChannelType,
    GatewayIntentBits,
    MessageFlags,
    PermissionFlagsBits,
    PermissionsBitField,
    type Client,
    type Guild,
    type MessageCreateOptions,
    type TextChannel,
} from 'discord.js';
import { getLogger } from '#core/utils/logger.js';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';
import { resolveGlobalPlaceholders } from '#core/placeholder/index.js';

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

        const owner = await guild.fetchOwner().catch(() => null);

        if (owner) {
            try {
                await owner.send(this.buildPermissionWarningPayload(guild, issues));
                log.info(`Feature permission warning DM sent to owner of guild ${guild.id}`);
                return;
            } catch (err) {
                log.warn(
                    `Feature permission warning DM failed for guild ${guild.id}: ${(err as Error).message}`,
                );
            }
        }

        const channel = await this.findAnnounceChannel(guild);
        if (!channel) {
            log.warn(`Feature permission warning: no channel to message in guild ${guild.id}`);
            return;
        }

        const ownerMention = owner ? `<@${owner.id}>` : guild.ownerId ? `<@${guild.ownerId}>` : 'server owner';
        try {
            await channel.send(this.buildPermissionWarningPayload(guild, issues, ownerMention));
            log.info(`Feature permission warning posted in #${channel.name} (${guild.id})`);
        } catch (err) {
            log.warn(
                `Feature permission warning failed in guild ${guild.id}: ${(err as Error).message}`,
            );
        }
    }

    private buildPermissionWarningPayload(
        guild: Guild,
        issues: Array<{ feature: FeatureRequirement; missing: bigint[] }>,
        mentionPrefix?: string,
    ): MessageCreateOptions {
        const botName = guild.client.user?.username ?? 'Bot';
        const featureLines = issues.map(({ feature, missing }) => {
            const label = feature.description ?? feature.id;
            const perms = missing.map(permissionLabel).join(', ');
            return `• **${label}** — \`${perms}\``;
        });

        let body = featureLines.join('\n');
        if (body.length > 3200) {
            body = `${featureLines.slice(0, 12).join('\n')}\n…and **${Math.max(0, featureLines.length - 12)}** more`;
        }

        const header = resolveGlobalPlaceholders(
            `%%emoji_warn%% **${botName}** joined **${guild.name}**`,
        );
        const intro = 'Missing Discord permissions for some features:';
        const footer =
            'Those features may not work as intended until the bot role is granted the listed permissions.\n' +
            'Granting **Administrator** to the bot role is the simplest way to fix all of them.';

        const children: Array<Record<string, unknown>> = [];
        if (mentionPrefix) {
            children.push({ type: 'text', content: mentionPrefix });
            children.push({ type: 'separator', divider: true, spacing: 'small' });
        }
        children.push({ type: 'text', content: header });
        children.push({ type: 'separator', divider: true, spacing: 'small' });
        children.push({ type: 'text', content: intro });
        children.push({ type: 'text', content: body });
        children.push({ type: 'separator', divider: true, spacing: 'small' });
        children.push({ type: 'text', content: footer });

        const layout: Cv2LayoutSpec = {
            version: 1,
            components: [
                {
                    type: 'container',
                    accentColor: 0xf0b232,
                    children: children as never,
                },
            ],
        };

        try {
            const built = buildComponentsV2(layout);
            return {
                components: built.components,
                files: built.files,
                flags: built.flags ?? MessageFlags.IsComponentsV2,
            };
        } catch (err) {
            log.warn(
                `CV2 build failed for feature warning, falling back to plain text: ${(err as Error).message}`,
            );
            const plain = [header, '', intro, body, '', footer].join('\n');
            return { content: mentionPrefix ? `${mentionPrefix}\n${plain}` : plain };
        }
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