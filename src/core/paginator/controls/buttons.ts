import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type APIMessageComponentEmoji } from 'discord.js';
import { encodeNavCustomId } from './ids.js';
import { paginationButtonBudget } from './capacity.js';
import type { NavAction } from '../types/models.js';

export type Cv2NavButtonStyle = 'primary' | 'secondary' | 'success' | 'danger' | 'link';

export interface Cv2NavButtonSpec {
    readonly type: 'button';
    readonly label: string;
    readonly style: Cv2NavButtonStyle;
    readonly customId: string;
    readonly disabled?: boolean;
    readonly emoji?: string | APIMessageComponentEmoji;
}

const STYLE_TO_NAME: Record<number, Cv2NavButtonStyle> = {
    [ButtonStyle.Primary]: 'primary',
    [ButtonStyle.Secondary]: 'secondary',
    [ButtonStyle.Success]: 'success',
    [ButtonStyle.Danger]: 'danger',
    [ButtonStyle.Link]: 'link',
};

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
            .setDisabled(disabled)
            .setLabel(label);
        if (emoji) b.setEmoji(emoji);
        return b;
    };

    const out: ButtonBuilder[] = [];

    if (options.utilCount > 0) {
        out.push(mk('prev', 'Prev', ButtonStyle.Secondary, atStart || pages <= 1, e.prev));
        out.push(mk('next', 'Next', ButtonStyle.Secondary, atEnd || pages <= 1, e.next));
        return out.slice(0, budget);
    }

    out.push(mk('first', '«', ButtonStyle.Secondary, atStart || pages <= 1, e.first));
    out.push(mk('prev', '‹', ButtonStyle.Primary, atStart || pages <= 1, e.prev));
    out.push(mk('noop', `${page}/${pages}`, ButtonStyle.Secondary, true));
    out.push(mk('next', '›', ButtonStyle.Primary, atEnd || pages <= 1, e.next));
    out.push(mk('last', '»', ButtonStyle.Secondary, atEnd || pages <= 1, e.last));

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

export function buttonBuilderToCv2Spec(button: ButtonBuilder): Cv2NavButtonSpec {
    const data = button.data as {
        custom_id?: string;
        label?: string | null;
        style?: number;
        disabled?: boolean;
        emoji?: APIMessageComponentEmoji;
        url?: string;
    };
    const style = STYLE_TO_NAME[data.style ?? ButtonStyle.Secondary] ?? 'secondary';
    const label =
        typeof data.label === 'string' && data.label.length > 0 ? data.label : '\u200b';
    const spec: Cv2NavButtonSpec = {
        type: 'button',
        label,
        style,
        customId: data.custom_id ?? 'zene:pg:invalid',
        disabled: !!data.disabled,
    };
    if (data.emoji) {
        return { ...spec, emoji: data.emoji };
    }
    return spec;
}

export function buttonBuildersToCv2ActionRows(
    buttons: ButtonBuilder[],
    util?: ButtonBuilder[],
): Array<{ type: 'actionRow'; components: Cv2NavButtonSpec[] }> {
    const all = [...(util ?? []), ...buttons].map(buttonBuilderToCv2Spec);
    const rows: Array<{ type: 'actionRow'; components: Cv2NavButtonSpec[] }> = [];
    for (let i = 0; i < all.length; i += 5) {
        rows.push({ type: 'actionRow', components: all.slice(i, i + 5) });
    }
    return rows;
}

export function navHasPageIndicator(buttons: ButtonBuilder[]): boolean {
    return buttons.some((b) => {
        const id = (b.data as { custom_id?: string }).custom_id ?? '';
        return id.endsWith(':noop');
    });
}
