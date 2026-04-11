import { random } from '#core/utils/random.js';
import { format } from '#core/utils/format.js';

export type ToolboxDomain = {
    readonly random: typeof random;
    readonly format: typeof format;
};

export const toolboxDomain = Object.freeze({
    random: random,
    format: format
});