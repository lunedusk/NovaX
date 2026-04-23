import { EmojiResolvable } from "./types.js";
import { assert } from "./errors.js";

export function resolveColor(color: number | string): number {
    if (typeof color === "number") {
        assert(color >= 0x000000 && color <= 0xffffff, `accentColor integer out of range: ${color}`);
        return color;
    }
    const hex = color.replace(/^#/, "");
    const parsed = parseInt(hex, 16);
    assert(!isNaN(parsed) && parsed >= 0 && parsed <= 0xffffff, `Invalid accentColor string: "${color}"`);
    return parsed;
}

export function normalizeEmoji(emoji: EmojiResolvable): { name?: string; id?: string; animated?: boolean } {
    if (typeof emoji === "string") return { name: emoji };
    return emoji;
}