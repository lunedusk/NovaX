import { 
    EmbedBuilder, 
    ComponentType, 
    ButtonStyle,
    APIEmbed
} from "discord.js";
import { EmbedLayout, EmbedSpec } from "../embedBuilder/types.js";
import { LayoutSpec, ComponentSpec, ActionRowSpec } from "../componentsv2Builder/types.js";

export class jsonBuilder {
    static fromEmbed(builder: EmbedBuilder): EmbedLayout {
        const data = builder.toJSON() as APIEmbed;
        const spec: EmbedSpec = this.clean({
            title: data.title,
            description: data.description,
            url: data.url,
            color: data.color,
            timestamp: data.timestamp,
            fields: data.fields?.map(f => ({ name: f.name, value: f.value, inline: f.inline })),
            author: data.author ? { 
                name: data.author.name, 
                iconURL: data.author.icon_url, 
                url: data.author.url 
            } : undefined,
            footer: data.footer ? { 
                text: data.footer.text, 
                iconURL: data.footer.icon_url 
            } : undefined,
            thumbnail: data.thumbnail ? { url: data.thumbnail.url } : undefined,
            image: data.image ? { url: data.image.url } : undefined,
        });

        return { embeds: [spec] };
    }

    static fromContainer(builder: any): LayoutSpec {
        const data = builder.toJSON();
        return {
            version: 1,
            components: (data.components || []).map((c: any) => this.mapComponent(c))
        };
    }

    private static mapComponent(c: any): ComponentSpec | any {
        switch (c.type) {
            case ComponentType.TextDisplay:
                return this.clean({ type: "text", content: c.content });

            case ComponentType.Separator:
                return this.clean({ 
                    type: "separator", 
                    divider: c.divider, 
                    spacing: c.spacing === 1 ? "small" : "large" 
                });

            case ComponentType.ActionRow:
                return this.clean({
                    type: "actionRow",
                    components: (c.components || []).map((inner: any) => this.decomposeInteractive(inner))
                }) as ActionRowSpec;

            case 4:
                return this.clean({
                    type: "section",
                    texts: (c.components || [])
                        .filter((comp: any) => comp.type === ComponentType.TextDisplay)
                        .map((t: any) => ({ type: "text", content: t.content })),
                    accessory: this.decomposeAccessory(c.accessory)
                });

            case 5:
                return this.clean({
                    type: "container",
                    accentColor: c.accent_color,
                    children: (c.components || []).map((child: any) => this.mapComponent(child))
                });

            case 6:
                return this.clean({
                    type: "mediaGallery",
                    items: (c.items || []).map((item: any) => ({
                        url: item.url,
                        description: item.description,
                        spoiler: item.spoiler
                    }))
                });

            case 7: // File
                return this.clean({
                    type: "file",
                    url: c.url,
                    spoiler: c.spoiler
                });

            default:
                return c;
        }
    }

    private static decomposeInteractive(inner: any): any {
        if (inner.type === ComponentType.Button) {
            return this.clean({
                type: "button",
                label: inner.label,
                style: this.mapButtonStyle(inner.style),
                customId: inner.custom_id,
                url: inner.url,
                disabled: inner.disabled,
                emoji: inner.emoji
            });
        }

        const selectKinds: Record<number, string> = {
            [ComponentType.StringSelect]: "string",
            [ComponentType.UserSelect]: "user",
            [ComponentType.RoleSelect]: "role",
            [ComponentType.MentionableSelect]: "mentionable",
            [ComponentType.ChannelSelect]: "channel"
        };

        if (selectKinds[inner.type]) {
            return this.clean({
                type: "selectMenu",
                kind: selectKinds[inner.type],
                customId: inner.custom_id,
                placeholder: inner.placeholder,
                minValues: inner.min_values,
                maxValues: inner.max_values,
                disabled: inner.disabled,
                options: inner.options,
                channelTypes: inner.channel_types
            });
        }

        return inner;
    }

    private static decomposeAccessory(acc: any): any {
        if (!acc) return undefined;
        if (acc.url) return { kind: "thumbnail", data: { url: acc.url } };
        return { kind: "button", data: this.decomposeInteractive(acc) };
    }

    private static mapButtonStyle(style: ButtonStyle): string {
        switch (style) {
            case ButtonStyle.Primary:   return "primary";
            case ButtonStyle.Secondary: return "secondary";
            case ButtonStyle.Success:   return "success";
            case ButtonStyle.Danger:    return "danger";
            case ButtonStyle.Link:      return "link";
            default:                    return "primary";
        }
    }

    private static clean<T>(obj: T): T {
        if (Array.isArray(obj)) return obj.map(v => this.clean(v)) as any;
        if (obj !== null && typeof obj === "object") {
            return Object.fromEntries(
                Object.entries(obj)
                    .filter(([_, v]) => v !== undefined && v !== null)
                    .map(([k, v]) => [k, this.clean(v)])
            ) as any;
        }
        return obj;
    }
}