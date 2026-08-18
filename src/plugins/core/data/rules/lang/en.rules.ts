import type { ValidationContext } from '#core/validation/index.js';
import type { IHeart } from '#core/heart/index.js';

export async function validate(
    data: unknown,
    _ctx: ValidationContext,
    heart?: IHeart | null
): Promise<true | string | string[]> {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return 'Language document must be a plain object';
    }
    const d = data as Record<string, unknown>;
    if (!d.commands || typeof d.commands !== 'object') {
        return 'commands section is required';
    }
    if (!d.layouts || typeof d.layouts !== 'object') {
        return 'layouts section is required';
    }
    heart?.log.debug('core lang rules: structure ok');
    return true;
}

export default validate;
