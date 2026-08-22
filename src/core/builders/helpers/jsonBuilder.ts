import {
    EmbedBuilder,
    ComponentType,
    ButtonStyle,
    type APIEmbed,
} from 'discord.js';
import { type EmbedLayout, type EmbedSpec } from '../embedBuilder/types.js';
import {
    type LayoutSpec,
    type ComponentSpec,
    type ActionRowSpec,
    type ButtonSpec,
    type SelectMenuSpec,
    type Cv2ButtonStyle,
    type SectionSpec,
    type StringSelectOptionSpec,
} from '../componentsv2Builder/types.js';

type DiscordComponentJson = {
    type: number;
    content?: string;
    divider?: boolean;
    spacing?: number;
    components?: DiscordComponentJson[];
    accessory?: DiscordComponentJson;
    accent_color?: number;
    items?: Array<{ url?: string; description?: string; spoiler?: boolean }>;
    url?: string;
    spoiler?: boolean;
    label?: string;
    style?: ButtonStyle | number;
    custom_id?: string;
    disabled?: boolean;
    emoji?: ButtonSpec['emoji'];
    placeholder?: string;
    min_values?: number;
    max_values?: number;
    options?: Array<{
        label?: string;
        value?: string;
        description?: string;
        emoji?: ButtonSpec['emoji'];
        default?: boolean;
    }>;
    channel_types?: number[];
};

type ContainerBuilderLike = {
    toJSON(): { components?: DiscordComponentJson[] };
};

export class jsonBuilder {
    static fromEmbed(builder: EmbedBuilder): EmbedLayout {
        const data = builder.toJSON() as APIEmbed;
        const spec: EmbedSpec = this.clean({
            title: data.title,
            description: data.description,
            url: data.url,
            color: data.color,
            timestamp: data.timestamp,
            fields: data.fields?.map((f) => ({ name: f.name, value: f.value, inline: f.inline })),
            author: data.author
                ? {
                      name: data.author.name,
                      iconURL: data.author.icon_url,
                      url: data.author.url,
                  }
                : undefined,
            footer: data.footer
                ? {
                      text: data.footer.text,
                      iconURL: data.footer.icon_url,
                  }
                : undefined,
            thumbnail: data.thumbnail ? { url: data.thumbnail.url } : undefined,
            image: data.image ? { url: data.image.url } : undefined,
        });

        return { embeds: [spec] };
    }

    static fromContainer(builder: ContainerBuilderLike): LayoutSpec {
        const data = builder.toJSON();
        return {
            version: 1,
            components: (data.components || []).map((c) => this.mapComponent(c)),
        };
    }

    private static mapComponent(c: DiscordComponentJson): ComponentSpec {
        switch (c.type) {
            case ComponentType.TextDisplay:
                return this.clean({ type: 'text', content: c.content ?? '' });

            case ComponentType.Separator:
                return this.clean({
                    type: 'separator',
                    divider: c.divider,
                    spacing: c.spacing === 1 ? 'small' : 'large',
                });

            case ComponentType.ActionRow:
                return this.clean({
                    type: 'actionRow',
                    components: (c.components || []).map((inner) => this.decomposeInteractive(inner)),
                }) as ActionRowSpec;

            case 4:
                return this.clean({
                    type: 'section',
                    texts: (c.components || [])
                        .filter((comp) => comp.type === ComponentType.TextDisplay)
                        .map((t) => ({ type: 'text' as const, content: t.content ?? '' })),
                    accessory: this.decomposeAccessory(c.accessory),
                }) as SectionSpec;

            case 5:
                return this.clean({
                    type: 'container',
                    accentColor: c.accent_color,
                    children: (c.components || []).map((child) => this.mapComponent(child)),
                });

            case 6:
                return this.clean({
                    type: 'mediaGallery',
                    items: (c.items || []).map((item) => ({
                        url: item.url ?? '',
                        description: item.description,
                        spoiler: item.spoiler,
                    })),
                });

            case 7:
                return this.clean({
                    type: 'file',
                    url: c.url ?? '',
                    spoiler: c.spoiler,
                });

            case ComponentType.Button:
            case ComponentType.StringSelect:
            case ComponentType.UserSelect:
            case ComponentType.RoleSelect:
            case ComponentType.MentionableSelect:
            case ComponentType.ChannelSelect:
                return this.wrapInteractive(this.decomposeInteractive(c));

            default:
                throw new TypeError(
                    `jsonBuilder.mapComponent: unsupported Discord component type ${String(c.type)}`,
                );
        }
    }

    private static wrapInteractive(inner: ButtonSpec | SelectMenuSpec): ActionRowSpec {
        return this.clean({
            type: 'actionRow',
            components: [inner],
        }) as ActionRowSpec;
    }

    private static decomposeInteractive(inner: DiscordComponentJson): ButtonSpec | SelectMenuSpec {
        if (inner.type === ComponentType.Button) {
            return this.clean({
                type: 'button',
                label: inner.label ?? '',
                style: this.mapButtonStyle(inner.style),
                customId: inner.custom_id,
                url: inner.url,
                disabled: inner.disabled,
                emoji: inner.emoji,
            });
        }

        if (inner.type === ComponentType.StringSelect) {
            const options: StringSelectOptionSpec[] = (inner.options ?? []).map((o) => ({
                label: o.label ?? '',
                value: o.value ?? '',
                description: o.description,
                emoji: o.emoji,
                default: o.default,
            }));
            return this.clean({
                type: 'selectMenu',
                kind: 'string' as const,
                customId: inner.custom_id ?? '',
                placeholder: inner.placeholder,
                minValues: inner.min_values,
                maxValues: inner.max_values,
                disabled: inner.disabled,
                options,
            });
        }

        if (inner.type === ComponentType.ChannelSelect) {
            return this.clean({
                type: 'selectMenu',
                kind: 'channel' as const,
                customId: inner.custom_id ?? '',
                placeholder: inner.placeholder,
                minValues: inner.min_values,
                maxValues: inner.max_values,
                disabled: inner.disabled,
                channelTypes: inner.channel_types,
            });
        }

        if (inner.type === ComponentType.UserSelect) {
            return this.clean({
                type: 'selectMenu',
                kind: 'user' as const,
                customId: inner.custom_id ?? '',
                placeholder: inner.placeholder,
                minValues: inner.min_values,
                maxValues: inner.max_values,
                disabled: inner.disabled,
            });
        }

        if (inner.type === ComponentType.RoleSelect) {
            return this.clean({
                type: 'selectMenu',
                kind: 'role' as const,
                customId: inner.custom_id ?? '',
                placeholder: inner.placeholder,
                minValues: inner.min_values,
                maxValues: inner.max_values,
                disabled: inner.disabled,
            });
        }

        if (inner.type === ComponentType.MentionableSelect) {
            return this.clean({
                type: 'selectMenu',
                kind: 'mentionable' as const,
                customId: inner.custom_id ?? '',
                placeholder: inner.placeholder,
                minValues: inner.min_values,
                maxValues: inner.max_values,
                disabled: inner.disabled,
            });
        }

        throw new TypeError(
            `jsonBuilder.decomposeInteractive: unsupported Discord interactive type ${String(inner.type)}`,
        );
    }

    private static decomposeAccessory(
        acc: DiscordComponentJson | undefined,
    ): SectionSpec['accessory'] | undefined {
        if (!acc) return undefined;
        if (acc.url && acc.type !== ComponentType.Button) {
            return { kind: 'thumbnail', data: { url: acc.url } };
        }
        if (acc.type === ComponentType.Button || acc.label || acc.custom_id) {
            const mapped = this.decomposeInteractive(
                acc.type === ComponentType.Button ? acc : { ...acc, type: ComponentType.Button },
            );
            if (mapped.type !== 'button') {
                throw new TypeError('jsonBuilder.decomposeAccessory: expected button accessory');
            }
            return { kind: 'button', data: mapped };
        }
        if (acc.url) return { kind: 'thumbnail', data: { url: acc.url } };
        throw new TypeError(
            `jsonBuilder.decomposeAccessory: unsupported accessory type ${String(acc.type)}`,
        );
    }

    private static mapButtonStyle(style: ButtonStyle | number | undefined): Cv2ButtonStyle {
        switch (style) {
            case ButtonStyle.Primary:
            case 1:
                return 'primary';
            case ButtonStyle.Secondary:
            case 2:
                return 'secondary';
            case ButtonStyle.Success:
            case 3:
                return 'success';
            case ButtonStyle.Danger:
            case 4:
                return 'danger';
            case ButtonStyle.Link:
            case 5:
                return 'link';
            default:
                return 'primary';
        }
    }

    private static clean<T>(obj: T): T {
        if (Array.isArray(obj)) {
            return obj.map((v) => this.clean(v)) as T;
        }
        if (obj !== null && typeof obj === 'object') {
            return Object.fromEntries(
                Object.entries(obj as Record<string, unknown>)
                    .filter(([, v]) => v !== undefined && v !== null)
                    .map(([k, v]) => [k, this.clean(v)]),
            ) as T;
        }
        return obj;
    }
}
