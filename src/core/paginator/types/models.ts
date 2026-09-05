import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    InteractionEditReplyOptions,
    InteractionReplyOptions,
    MessageCreateOptions,
    MessageEditOptions,
} from 'discord.js';
import type { EmbedBuilder } from 'discord.js';

export type RenderMode = 'content' | 'embed' | 'cv2' | 'custom';

export type NavAction = 'first' | 'prev' | 'next' | 'last' | 'close' | 'noop';

export interface AtomicUnit {
    readonly id: string;
    readonly text: string;
    readonly weight?: number;
}

export interface PageMeta {
    readonly page: number;
    readonly pages: number;
    readonly totalUnits: number;
}

export type PagePayload =
    | { readonly mode: 'content'; readonly content: string }
    | { readonly mode: 'embed'; readonly embeds: EmbedBuilder[]; readonly content?: string }
    | {
          readonly mode: 'cv2';
          readonly textParts: readonly string[];
          readonly title?: string;
          readonly accentColor?: number;
      }
    | {
          readonly mode: 'custom';
          readonly build: (meta: PageMeta) => InteractionReplyOptions | InteractionEditReplyOptions | MessageCreateOptions;
      };

export type InteractionTarget =
    | ChatInputCommandInteraction
    | ButtonInteraction;

export type ReplyLike = InteractionReplyOptions & MessageEditOptions & InteractionEditReplyOptions;
