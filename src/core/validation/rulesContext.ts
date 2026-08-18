import type { IHeart } from '#core/heart/index.js';
import type { ValidationContext } from './types.js';

export type RulesValidateWithHeart = (
    data: unknown,
    ctx: ValidationContext,
    heart?: IHeart | null
) => boolean | string | string[] | Promise<boolean | string | string[]>;

export type RulesFactory = (heart: IHeart) => RulesValidateWithHeart | Promise<RulesValidateWithHeart>;

let heartProvider: (() => IHeart | null) | null = null;

export function setRulesHeartProvider(fn: (() => IHeart | null) | null): void {
    heartProvider = fn;
}

export function getRulesHeart(): IHeart | null {
    try {
        return heartProvider?.() ?? null;
    } catch {
        return null;
    }
}
