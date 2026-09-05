import { PAGINATOR_LIMITS } from '../limits/discord.js';
import type { ButtonBuilder } from 'discord.js';

export function paginationButtonBudget(utilCount: number): number {
    if (utilCount > 0) return PAGINATOR_LIMITS.MAX_BUTTONS_WITH_UTIL;
    return Math.min(5, PAGINATOR_LIMITS.MAX_BUTTONS_STANDALONE);
}

export function canAttachNav(options: {
    readonly existingButtonCount?: number;
    readonly existingRowCount?: number;
    readonly utilButtons?: readonly ButtonBuilder[];
    readonly neededButtons: number;
}): boolean {
    const util = options.utilButtons?.length ?? 0;
    const budget = paginationButtonBudget(util);
    if (options.neededButtons > budget) return false;

    const existingButtons = options.existingButtonCount ?? 0;
    const existingRows = options.existingRowCount ?? 0;

    if (existingRows >= PAGINATOR_LIMITS.MAX_ACTION_ROWS) {
        const freeOnLast = Math.max(0, PAGINATOR_LIMITS.MAX_COMPONENTS_PER_ROW - (existingButtons % PAGINATOR_LIMITS.MAX_COMPONENTS_PER_ROW || PAGINATOR_LIMITS.MAX_COMPONENTS_PER_ROW));
        if (existingButtons > 0 && freeOnLast >= options.neededButtons + util) return true;
        return false;
    }

    const totalButtons = options.neededButtons + util;
    if (totalButtons <= PAGINATOR_LIMITS.MAX_COMPONENTS_PER_ROW) return true;
    const rowsNeeded = Math.ceil(totalButtons / PAGINATOR_LIMITS.MAX_COMPONENTS_PER_ROW);
    return existingRows + rowsNeeded <= PAGINATOR_LIMITS.MAX_ACTION_ROWS;
}
