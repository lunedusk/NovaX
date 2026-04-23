import { ColorResolvable } from "discord.js";

export function resolveColor(color: ColorResolvable | string | number | undefined): ColorResolvable | null {
    if (color === undefined || color === null) return null;
    if (typeof color === "number") return color as ColorResolvable;
    if (typeof color === "string") {
        const hex = color.replace(/^#/, "");
        const parsed = parseInt(hex, 16);
        if (!isNaN(parsed)) return parsed as ColorResolvable;
    }
    return color as ColorResolvable;
}

export function resolveTimestamp(ts: string | number | Date | boolean | "now"): Date | null {
    if (ts === true || ts === "now")     return new Date();
    if (ts instanceof Date)              return ts;
    if (typeof ts === "number")          return new Date(ts > 9_999_999_999 ? ts : ts * 1000);
    if (typeof ts === "string") {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}