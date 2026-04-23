import { ColorResolvable, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { AssetManager, AttachmentInput } from "../helpers/assets.js";

export interface EmbedAuthorSpec { name?: string; url?: string; iconURL?: string; }
export interface EmbedFooterSpec { text?: string; iconURL?: string; }
export interface EmbedFieldSpec { name: string; value: string; inline?: boolean; }
export interface EmbedImageLikeSpec { url: string; }

export interface EmbedSpec {
    title?:       string;
    description?: string;
    url?:         string;
    color?:       ColorResolvable | string | number;
    timestamp?:   string | number | Date | boolean | "now";
    author?:      EmbedAuthorSpec;
    footer?:      EmbedFooterSpec;
    thumbnail?:   EmbedImageLikeSpec;
    image?:       EmbedImageLikeSpec;
    fields?:      EmbedFieldSpec[];
}

export interface EmbedLayout {
    embeds: EmbedSpec[];
}

export interface BuildContext {
    assetManager?: AssetManager;
    attachments?:  Record<string, AttachmentInput>;
    variables?:    Record<string, any>;
}

export interface BuildOptions {
    strict?: boolean;
}

export interface EmbedBuildResult {
    embeds: EmbedBuilder[];
    files:  AttachmentBuilder[];
}