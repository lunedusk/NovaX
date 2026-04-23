import { EmbedBuilder } from "discord.js";
import { LIMITS } from "./constants.js";
import { assert } from "./errors.js";
import { EmbedLayout, BuildContext, BuildOptions, EmbedBuildResult, EmbedSpec } from "./types.js";
import { resolveColor, resolveTimestamp } from "./utils.js";
import { sanitizeMarkdownString } from "../helpers/string.js";
import { AssetManager } from "../helpers/assets.js";

export function runBuild(layout: EmbedLayout, context: BuildContext, options: BuildOptions): EmbedBuildResult {
    const strict = options.strict ?? false;
    const assets = context.assetManager || new AssetManager(context.attachments || {});

    assert(layout && Array.isArray(layout.embeds), "EmbedLayout.embeds must be an array");
    assert(layout.embeds.length > 0, "At least one embed is required");

    let targetEmbeds: EmbedSpec[] = [];
    if (strict) {
        targetEmbeds.push(...layout.embeds);
    } else {
        for (const emb of layout.embeds) {
            if (emb.fields && emb.fields.length > LIMITS.MAX_EMBED_FIELDS) {
                const clonedFields = [...emb.fields];
                targetEmbeds.push({ ...emb, fields: clonedFields.splice(0, LIMITS.MAX_EMBED_FIELDS) });
                while (clonedFields.length > 0) {
                    targetEmbeds.push({ color: emb.color, fields: clonedFields.splice(0, LIMITS.MAX_EMBED_FIELDS) });
                }
            } else {
                targetEmbeds.push(emb);
            }
        }
    }

    if (strict) assert(targetEmbeds.length <= LIMITS.MAX_EMBEDS_PER_MESSAGE, `Embed count exceeds limit of ${LIMITS.MAX_EMBEDS_PER_MESSAGE}`);
    else targetEmbeds = targetEmbeds.slice(0, LIMITS.MAX_EMBEDS_PER_MESSAGE);

    let totalChars = 0;
    const bumpChars = (text: string, path: string) => {
        totalChars += text.length;
        if (strict) assert(totalChars <= LIMITS.MAX_TOTAL_EMBED_CHARS, `Total embed character count exceeds ${LIMITS.MAX_TOTAL_EMBED_CHARS}`, path);
    };

    const builtEmbeds = targetEmbeds.map((emb, idx) => {
        const path = `embeds[${idx}]`;
        const builder = new EmbedBuilder();

        if (emb.title !== undefined) {
            const safe = strict ? emb.title : sanitizeMarkdownString(emb.title, LIMITS.MAX_EMBED_TITLE);
            if (strict) assert(emb.title.length <= LIMITS.MAX_EMBED_TITLE, `Title exceeds limit`, `${path}.title`);
            bumpChars(safe, `${path}.title`);
            builder.setTitle(safe);
        }

        if (emb.description !== undefined) {
            const safe = strict ? emb.description : sanitizeMarkdownString(emb.description, LIMITS.MAX_EMBED_DESCRIPTION);
            if (strict) assert(emb.description.length <= LIMITS.MAX_EMBED_DESCRIPTION, `Description exceeds limit`, `${path}.description`);
            bumpChars(safe, `${path}.description`);
            builder.setDescription(safe);
        }

        if (emb.url) builder.setURL(emb.url);
        const color = resolveColor(emb.color);
        if (color !== null) builder.setColor(color);
        const ts = resolveTimestamp(emb.timestamp ?? null as any);
        if (ts) builder.setTimestamp(ts);

        if (emb.author) {
            const aPath = `${path}.author`;
            if (emb.author.iconURL) assets.getAttachment(emb.author.iconURL, `${aPath}.iconURL`, strict);
            if (strict) {
                const name = emb.author.name;
                if (name !== undefined) {
                    assert(name.length <= LIMITS.MAX_AUTHOR_NAME, `Author name exceeds limit`, `${aPath}.name`);
                    bumpChars(name, `${aPath}.name`);
                }
                if (emb.author.iconURL && !name) assert(false, "author.iconURL requires author.name", `${aPath}.name`);
                if (name !== undefined) builder.setAuthor({ name, url: emb.author.url, iconURL: emb.author.iconURL });
            } else {
                const rawName = emb.author.name ?? (emb.author.iconURL ? LIMITS.ZERO_WIDTH_SPACE : undefined);
                if (rawName !== undefined) {
                    const safe = sanitizeMarkdownString(rawName, LIMITS.MAX_AUTHOR_NAME);
                    bumpChars(safe, `${aPath}.name`);
                    builder.setAuthor({ name: safe, url: emb.author.url, iconURL: emb.author.iconURL });
                }
            }
        }

        if (emb.footer) {
            const fPath = `${path}.footer`;
            if (emb.footer.iconURL) assets.getAttachment(emb.footer.iconURL, `${fPath}.iconURL`, strict);
            if (strict) {
                if (emb.footer.iconURL && !emb.footer.text) assert(false, "footer.iconURL requires footer.text", `${fPath}.text`);
                if (emb.footer.text !== undefined) {
                    assert(emb.footer.text.length <= LIMITS.MAX_FOOTER_TEXT, `Footer text exceeds limit`, `${fPath}.text`);
                    bumpChars(emb.footer.text, `${fPath}.text`);
                    builder.setFooter({ text: emb.footer.text, iconURL: emb.footer.iconURL });
                }
            } else {
                const rawText = emb.footer.text ?? (emb.footer.iconURL ? LIMITS.ZERO_WIDTH_SPACE : undefined);
                if (rawText !== undefined) {
                    const safe = sanitizeMarkdownString(rawText, LIMITS.MAX_FOOTER_TEXT);
                    bumpChars(safe, `${fPath}.text`);
                    builder.setFooter({ text: safe, iconURL: emb.footer.iconURL });
                }
            }
        }

        if (emb.thumbnail) {
            assets.getAttachment(emb.thumbnail.url, `${path}.thumbnail`, strict);
            builder.setThumbnail(emb.thumbnail.url);
        }

        if (emb.image) {
            assets.getAttachment(emb.image.url, `${path}.image`, strict);
            builder.setImage(emb.image.url);
        }

        if (emb.fields && emb.fields.length > 0) {
            const fieldsTarget = strict ? emb.fields : emb.fields.slice(0, LIMITS.MAX_EMBED_FIELDS);
            if (strict) assert(emb.fields.length <= LIMITS.MAX_EMBED_FIELDS, `Fields exceed limit`, `${path}.fields`);

            const builtFields: { name: string; value: string; inline: boolean }[] = [];
            fieldsTarget.forEach((fld, fIdx) => {
                const fPath = `${path}.fields[${fIdx}]`;
                if (strict) {
                    assert(typeof fld.name === "string" && fld.name.length > 0, "Field name empty", fPath);
                    assert(fld.name.length <= LIMITS.MAX_FIELD_NAME, `Field name exceeds limit`, fPath);
                    assert(typeof fld.value === "string" && fld.value.length > 0, "Field value empty", fPath);
                    assert(fld.value.length <= LIMITS.MAX_FIELD_VALUE, `Field value exceeds limit`, fPath);
                    bumpChars(fld.name + fld.value, fPath);
                    builtFields.push({ name: fld.name, value: fld.value, inline: !!fld.inline });
                } else {
                    const safeName = sanitizeMarkdownString(fld.name, LIMITS.MAX_FIELD_NAME);
                    const safeValue = sanitizeMarkdownString(fld.value, LIMITS.MAX_FIELD_VALUE);
                    bumpChars(safeName + safeValue, fPath);
                    builtFields.push({ name: safeName, value: safeValue, inline: !!fld.inline });
                }
            });
            builder.addFields(...builtFields);
        }

        return builder;
    });

    if (!strict && totalChars > LIMITS.MAX_TOTAL_EMBED_CHARS) {
        let running = 0;
        const safeEmbeds: EmbedBuilder[] = [];
        for (const b of builtEmbeds) {
            const len = b.length;
            if (running + len <= LIMITS.MAX_TOTAL_EMBED_CHARS) {
                safeEmbeds.push(b);
                running += len;
            } else break;
        }
        return { embeds: safeEmbeds, files: assets.exportFiles() };
    }

    assert(totalChars <= LIMITS.MAX_TOTAL_EMBED_CHARS, `Total character limit exceeded`);
    return { embeds: builtEmbeds, files: assets.exportFiles() };
}