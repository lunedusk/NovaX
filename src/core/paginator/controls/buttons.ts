import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { encodeNavCustomId } from './ids.js';
import { paginationButtonBudget } from './capacity.js';
import type { NavAction } from '../types/models.js';

export function buildNavButtons(options: {
    readonly sessionId: string;
    readonly page: number;
    readonly pages: number;
    readonly utilCount: number;
    readonly showClose?: boolean;
    readonly emojis?: {
        readonly first?: string;
        readonly prev?: string;
        readonly next?: string;
        readonly last?: string;
        readonly close?: string;
    };
}): ButtonBuilder[] {
    const budget = paginationButtonBudget(options.utilCount);
    const page = options.page;
    const pages = Math.max(1, options.pages);
    const atStart = page <= 1;
    const atEnd = page >= pages;

    const e = options.emojis ?? {};
    const mk = (action: NavAction, label: string, style: ButtonStyle, disabled: boolean, emoji?: string): ButtonBuilder => {
        const b = new ButtonBuilder()
            .setCustomId(encodeNavCustomId(options.sessionId, action))
            .setStyle(style)
            .setDisabled(disabled);
        if (emoji) b.setEmoji(emoji);
        else b.setLabel(label);
        return b;
    };

    const out: ButtonBuilder[] = [];

    if (options.utilCount > 0) {
        out.push(mk('prev', 'Prev', ButtonStyle.Secondary, atStart || pages <= 1, e.prev));
        out.push(mk('next', 'Next', ButtonStyle.Secondary, atEnd || pages <= 1, e.next));
        return out.slice(0, budget);
    }

    out.push(mk('first', 'First', ButtonStyle.Secondary, atStart || pages <= 1, e.first));
    out.push(mk('prev', 'Prev', ButtonStyle.Primary, atStart || pages <= 1, e.prev));
    out.push(
        mk('noop', `${page}/${pages}`, ButtonStyle.Secondary, true),
    );
    out.push(mk('next', 'Next', ButtonStyle.Primary, atEnd || pages <= 1, e.next));
    out.push(mk('last', 'Last', ButtonStyle.Secondary, atEnd || pages <= 1, e.last));

    if (options.showClose && out.length < budget) {
        out.push(mk('close', 'Close', ButtonStyle.Danger, false, e.close));
    }

    return out.slice(0, budget);
}

export function buildNavRow(
    buttons: ButtonBuilder[],
    util?: ButtonBuilder[],
): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const all = [...(util ?? []), ...buttons];
    for (let i = 0; i < all.length; i += 5) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(all.slice(i, i + 5)));
    }
    return rows;
}
