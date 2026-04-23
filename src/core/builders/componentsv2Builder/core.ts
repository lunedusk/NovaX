import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MentionableSelectMenuBuilder, MessageFlags, RoleSelectMenuBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, ThumbnailBuilder, UserSelectMenuBuilder, type ComponentBuilder } from "discord.js";
import { MAX_COMPONENTS_TOTAL, MAX_TEXT_CHARS_TOTAL, MAX_COMPONENTS_PER_ROW, MAX_MEDIA_ITEMS, MAX_SELECT_OPTIONS, MAX_LABEL_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_CUSTOM_ID_LENGTH, MAX_COMPONENT_ID } from "./constants.js";
import { assert, assertNever, ComponentV2Error } from "./errors.js";
import { BaseSpec, BuildContext, BuildOptions, BuildResult, ButtonSpec, ComponentSpec, ContainerSpec, FileSpec, LayoutSpec, MediaGallerySpec, SectionSpec, SelectMenuSpec, SeparatorSpec, TextDisplaySpec, ThumbnailAccessorySpec, ActionRowSpec, StringSelectOptionSpec, MediaGalleryItemSpec } from "./types.js";
import { normalizeEmoji, resolveColor } from "./utils.js";
import { isValidUrl } from "../helpers/url.js";
import { AssetManager } from "../helpers/assets.js";
import { interpolateVariables } from "../helpers/string.js";

export function createBuildCore(context: BuildContext, options: BuildOptions) {
    const assets = context.assetManager || new AssetManager();
    let componentCount = 0;
    let textCharCount = 0;

    const bumpComponents = (path: string) => {
        componentCount++;
        assert(componentCount <= MAX_COMPONENTS_TOTAL, `Component limit (${MAX_COMPONENTS_TOTAL}) exceeded`, path);
    };

    const bumpText = (text: string, path: string) => {
        textCharCount += text.length;
        assert(textCharCount <= MAX_TEXT_CHARS_TOTAL, `Total text length (${MAX_TEXT_CHARS_TOTAL} chars) exceeded`, path);
    };

    const applyId = <T extends { setId?(id: number): unknown }>(builder: T, baseSpec: BaseSpec, path: string): T => {
        if (baseSpec.id !== undefined) {
            assert(Number.isInteger(baseSpec.id) && baseSpec.id >= 0 && baseSpec.id <= MAX_COMPONENT_ID, `Invalid ID`, path);
            if (typeof builder.setId === "function") builder.setId(baseSpec.id);
        }
        return builder;
    };

    const normalizeChildren = (children: ComponentSpec[]): ComponentSpec[] => {
        const out: ComponentSpec[] = [];
        let buttonRow: ButtonSpec[] = [];

        const flushButtons = () => {
            if (buttonRow.length > 0) {
                out.push({ type: "actionRow", components: [...buttonRow] } as ActionRowSpec);
                buttonRow = [];
            }
        };

        for (const child of children) {
            const type = child.type;
            if (type === "button") {
                buttonRow.push(child as ButtonSpec);
                if (buttonRow.length === 5) flushButtons();
            } else if (type === "selectMenu") {
                flushButtons(); 
                out.push({ type: "actionRow", components: [child as SelectMenuSpec] } as ActionRowSpec);
            } else {
                flushButtons();
                out.push(child);
            }
        }
        flushButtons();
        return out;
    };

    const buildTextDisplay = (cSpec: TextDisplaySpec, path: string): TextDisplayBuilder => {
        assert(typeof cSpec.content === "string" && cSpec.content.length > 0, "TextDisplay content must be non-empty", path);
        bumpText(cSpec.content, path);
        return applyId(new TextDisplayBuilder().setContent(cSpec.content), cSpec, path);
    };

    const buildSeparator = (cSpec: SeparatorSpec, path: string): SeparatorBuilder => {
        const b = new SeparatorBuilder();
        if (cSpec.divider !== undefined) b.setDivider(!!cSpec.divider);
        if (cSpec.spacing) b.setSpacing(cSpec.spacing === "small" ? SeparatorSpacingSize.Small : SeparatorSpacingSize.Large);
        return applyId(b, cSpec, path);
    };

    const buildThumbnail = (cSpec: ThumbnailAccessorySpec, path: string): ThumbnailBuilder => {
        assert(isValidUrl(cSpec.url), `Invalid URL: "${cSpec.url}"`, path);
        const b = new ThumbnailBuilder().setURL(cSpec.url);
        if (cSpec.description) {
            assert(cSpec.description.length <= MAX_DESCRIPTION_LENGTH, `Description exceeds limit`, path);
            bumpText(cSpec.description, path);
            b.setDescription(cSpec.description);
        }
        if (cSpec.spoiler) b.setSpoiler(true);
        assets.getAttachment(cSpec.url, path, true);
        return b;
    };

    const buildButton = (cSpec: ButtonSpec, path: string): ButtonBuilder => {
        assert(typeof cSpec.label === "string" && cSpec.label.length > 0, "Button label missing", path);
        assert(cSpec.label.length <= MAX_LABEL_LENGTH, `Button label exceeds limit`, path);
        bumpText(cSpec.label, path);

        const b = new ButtonBuilder().setLabel(cSpec.label);
        const styles: Record<string, ButtonStyle> = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger, link: ButtonStyle.Link };
        b.setStyle(styles[cSpec.style]);

        if (cSpec.emoji) b.setEmoji(normalizeEmoji(cSpec.emoji));

        if (cSpec.style === "link") {
            assert(cSpec.url && isValidUrl(cSpec.url), "Link button requires valid URL", path);
            b.setURL(cSpec.url!);
        } else {
            assert(cSpec.customId, "Non-link button requires customId", path);
            const hydratedId = cSpec.payload?.length ? `${cSpec.customId}:${cSpec.payload.join(':')}` : cSpec.customId!;
            assert(hydratedId.length <= MAX_CUSTOM_ID_LENGTH, `Hydrated customId exceeds ${MAX_CUSTOM_ID_LENGTH} chars`, path);
            b.setCustomId(hydratedId);
        }

        b.setDisabled(context.disableAll ? true : !!cSpec.disabled);
        return applyId(b, cSpec, path);
    };

    const buildSelectMenu = (cSpec: SelectMenuSpec, path: string) => {
        assert(cSpec.customId, "SelectMenu requires customId", path);
        const hydratedId = cSpec.payload?.length ? `${cSpec.customId}:${cSpec.payload.join(':')}` : cSpec.customId!;
        assert(hydratedId.length <= MAX_CUSTOM_ID_LENGTH, `Hydrated customId exceeds limit`, path);

        if (cSpec.minValues !== undefined && cSpec.maxValues !== undefined) {
            assert(cSpec.minValues >= 0 && cSpec.maxValues >= 1 && cSpec.minValues <= cSpec.maxValues, `Invalid min/max values`, path);
        }

        const applyBase = <T extends { setCustomId(id: string): T; setPlaceholder(p: string): T; setMinValues(v: number): T; setMaxValues(v: number): T; setDisabled(d: boolean): T; }>(builder: T): T => {
            builder.setCustomId(hydratedId);
            if (cSpec.placeholder) builder.setPlaceholder(cSpec.placeholder);
            if (cSpec.minValues !== undefined) builder.setMinValues(cSpec.minValues);
            if (cSpec.maxValues !== undefined) builder.setMaxValues(cSpec.maxValues);
            builder.setDisabled(context.disableAll ? true : !!cSpec.disabled);
            return builder;
        };

        switch (cSpec.kind) {
            case "string": {
                assert(Array.isArray(cSpec.options) && cSpec.options.length > 0, "Requires at least one option", path);
                assert(cSpec.options.length <= MAX_SELECT_OPTIONS, `Exceeds ${MAX_SELECT_OPTIONS} options`, path);
                const b = applyBase(new StringSelectMenuBuilder());
                b.addOptions(cSpec.options.map((opt: StringSelectOptionSpec, idx: number) => {
                    const p = `${path}.options[${idx}]`;
                    assert(opt.label && opt.value, "Option missing label/value", p);
                    bumpText(opt.label, p);
                    if (opt.description) bumpText(opt.description, p);
                    return { label: opt.label, value: opt.value, description: opt.description, emoji: opt.emoji ? normalizeEmoji(opt.emoji) : undefined, default: opt.default };
                }));
                return applyId(b, cSpec, path);
            }
            case "channel": return applyId(applyBase(new ChannelSelectMenuBuilder()).addChannelTypes(...(cSpec.channelTypes || [])), cSpec, path);
            case "user": return applyId(applyBase(new UserSelectMenuBuilder()), cSpec, path);
            case "role": return applyId(applyBase(new RoleSelectMenuBuilder()), cSpec, path);
            case "mentionable": return applyId(applyBase(new MentionableSelectMenuBuilder()), cSpec, path);
            default: return assertNever(cSpec as never, `Unknown select kind`);
        }
    };

    const buildActionRow = (cSpec: ActionRowSpec, path: string): ActionRowBuilder<any> => {
        assert(Array.isArray(cSpec.components) && cSpec.components.length > 0, "ActionRow missing components", path);
        assert(cSpec.components.length <= MAX_COMPONENTS_PER_ROW, `ActionRow exceeds max components`, path);
        const row = new ActionRowBuilder<any>();
        cSpec.components.forEach((child: ButtonSpec | SelectMenuSpec, idx: number) => {
            if (child.type === "button") row.addComponents(buildButton(child as ButtonSpec, `${path}.components[${idx}]`));
            else if (child.type === "selectMenu") row.addComponents(buildSelectMenu(child as SelectMenuSpec, `${path}.components[${idx}]`));
            else throw new ComponentV2Error("ActionRow only accepts buttons and select menus", path);
        });
        return applyId(row as any, cSpec, path);
    };

    const buildMediaGallery = (cSpec: MediaGallerySpec, path: string): MediaGalleryBuilder => {
        assert(Array.isArray(cSpec.items) && cSpec.items.length > 0, "MediaGallery missing items", path);
        assert(cSpec.items.length <= MAX_MEDIA_ITEMS, `MediaGallery exceeds limit`, path);
        const b = new MediaGalleryBuilder();
        cSpec.items.forEach((item: MediaGalleryItemSpec, idx: number) => {
            const p = `${path}.items[${idx}]`;
            assert(isValidUrl(item.url), `Invalid URL`, p);
            const ib = new MediaGalleryItemBuilder().setURL(item.url);
            if (item.description) { bumpText(item.description, p); ib.setDescription(item.description); }
            if (item.spoiler) ib.setSpoiler(true);
            assets.getAttachment(item.url, p, true);
            b.addItems(ib);
        });
        return applyId(b, cSpec, path);
    };

    const buildFile = (cSpec: FileSpec, path: string): ComponentBuilder => {
        assert(cSpec.url?.startsWith("attachment://"), `File URL must use attachment://`, path);
        const att = assets.getAttachment(cSpec.url, path, true);
        if (cSpec.spoiler && att) att.setSpoiler(true);
        const { FileBuilder } = require("discord.js");
        return applyId(new FileBuilder().setURL(cSpec.url), cSpec, path);
    };

    const buildSection = (cSpec: SectionSpec, path: string): SectionBuilder => {
        assert(Array.isArray(cSpec.texts) && cSpec.texts.length >= 1 && cSpec.texts.length <= 3, "Section requires 1-3 texts", path);
        assert(!!cSpec.accessory, "Section missing accessory", path);
        const b = new SectionBuilder();
        b.addTextDisplayComponents(...cSpec.texts.map((t: TextDisplaySpec, idx: number) => buildTextDisplay(t, `${path}.texts[${idx}]`)));
        if (cSpec.accessory.kind === "thumbnail") b.setThumbnailAccessory(buildThumbnail(cSpec.accessory.data, `${path}.accessory.thumbnail`));
        else if (cSpec.accessory.kind === "button") b.setButtonAccessory(buildButton(cSpec.accessory.data, `${path}.accessory.button`));
        else throw new ComponentV2Error("Unknown accessory kind", path);
        return applyId(b, cSpec, path);
    };

    const buildContainer = (cSpec: ContainerSpec, path: string): ContainerBuilder => {
        const b = new ContainerBuilder();
        if (cSpec.accentColor !== undefined) b.setAccentColor(resolveColor(cSpec.accentColor));
        if (cSpec.spoiler) b.setSpoiler(true);
        assert(Array.isArray(cSpec.children) && cSpec.children.length > 0, "Container must have children", path);

        const children = options.autoWrapInteractives ? normalizeChildren(cSpec.children) : cSpec.children;

        children.forEach((child: ComponentSpec, idx: number) => {
            const p = `${path}.children[${idx}]`;
            bumpComponents(p);
            switch (child.type) {
                case "text": b.addTextDisplayComponents(buildTextDisplay(child as TextDisplaySpec, p)); break;
                case "separator": b.addSeparatorComponents(buildSeparator(child as SeparatorSpec, p)); break;
                case "section": b.addSectionComponents(buildSection(child as SectionSpec, p)); break;
                case "mediaGallery": b.addMediaGalleryComponents(buildMediaGallery(child as MediaGallerySpec, p)); break;
                case "file": b.addFileComponents(buildFile(child as FileSpec, p) as any); break;
                case "actionRow": b.addActionRowComponents(buildActionRow(child as ActionRowSpec, p)); break;
                default: return assertNever(child as never, `Unsupported component`);
            }
        });
        return applyId(b, cSpec, path);
    };

    const buildComponent = (spec: ComponentSpec, path: string): ComponentBuilder => {
        bumpComponents(path);
        switch (spec.type) {
            case "text": return buildTextDisplay(spec, path);
            case "separator": return buildSeparator(spec, path);
            case "section": return buildSection(spec, path);
            case "mediaGallery": return buildMediaGallery(spec, path);
            case "file": return buildFile(spec, path);
            case "actionRow": return buildActionRow(spec, path);
            case "container": return buildContainer(spec as ContainerSpec, path);
            default: return assertNever(spec as never, `Unknown top-level component type`);
        }
    };

    return { buildComponent, assets };
}

export function runBuild(layout: LayoutSpec, context: BuildContext, options: BuildOptions): BuildResult {
    const spec = interpolateVariables(layout, context.variables);
    
    assert(spec && typeof spec === "object", "LayoutSpec must be an object");
    assert(spec.version === 1, `Unsupported layout version: ${spec.version}`);
    assert(Array.isArray(spec.components), "LayoutSpec.components must be an array");

    const { buildComponent, assets } = createBuildCore(context, options);
    
    const components = spec.components.map((c: ComponentSpec, idx: number) => {
        const builder = buildComponent(c, `components[${idx}]`);
        return typeof (builder as any).toJSON === "function" ? (builder as any).toJSON() : builder;
    });

    return {
        components,
        files: assets.exportFiles(),
        flags: MessageFlags.IsComponentsV2,
    };
}