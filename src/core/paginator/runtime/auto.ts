import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import type { IHeart } from '#core/heart/index.js';
import { PAGINATOR_LIMITS } from '../limits/discord.js';
import { Paginator, unitsFromLines, canPaginateWithNav } from './Paginator.js';
import { canAttachNav } from '../controls/capacity.js';

export interface AutoPaginateOptions {
    readonly heart: IHeart;
    readonly interaction: ChatInputCommandInteraction | ButtonInteraction;
    readonly title?: string;
    readonly lines: readonly string[];
    readonly mode?: 'cv2' | 'embed' | 'content';
    readonly accentColor?: number;
    readonly ephemeral?: boolean;
    readonly existingButtonCount?: number;
    readonly existingRowCount?: number;
    readonly utilButtonCount?: number;
}

export type AutoPaginateResult =
    | { readonly paginated: true; readonly sessionId: string; readonly pages: number }
    | { readonly paginated: false; readonly reason: 'under_budget' | 'no_nav_capacity' };

export async function replyOrPaginate(options: AutoPaginateOptions): Promise<AutoPaginateResult> {
    const mode = options.mode ?? 'cv2';
    const joined = options.lines.join('\n');

    const under =
        mode === 'embed'
            ? joined.length <= PAGINATOR_LIMITS.EMBED_DESCRIPTION - 80
            : mode === 'content'
              ? joined.length <= PAGINATOR_LIMITS.CONTENT_CHARS
              : joined.length <= PAGINATOR_LIMITS.CV2_TEXT_SAFE;

    if (under) {
        return { paginated: false, reason: 'under_budget' };
    }

    const util = options.utilButtonCount ?? 0;
    const needed = util > 0 ? 2 : 3;
    const ok = canAttachNav({
        neededButtons: needed,
        existingButtonCount: options.existingButtonCount ?? 0,
        existingRowCount: options.existingRowCount ?? 0,
        utilButtons: util > 0 ? (Array.from({ length: util }) as never) : undefined,
    });
    if (!ok || !canPaginateWithNav(util)) {
        return { paginated: false, reason: 'no_nav_capacity' };
    }

    const paginator = new Paginator({
        heart: options.heart,
        units: unitsFromLines(options.lines),
        mode,
        title: options.title,
        accentColor: options.accentColor,
        session: { ephemeral: options.ephemeral ?? true, authorOnly: true },
        split: { preferUnits: 2 },
    });
    const result = await paginator.reply(options.interaction);
    return { paginated: true, sessionId: result.sessionId, pages: result.pages };
}
