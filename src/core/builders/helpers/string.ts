import { configManager } from '#core/manager/config.js';
import { emojis } from '#core/manager/emoji.js';

type PlaceholderMap = Record<string, string>;

function flattenPlaceholders(source: unknown, prefix = '', output: PlaceholderMap = {}): PlaceholderMap {
    if (!source || typeof source !== 'object') {
        return output;
    }

    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
        const nextKey = prefix ? `${prefix}.${key}` : key;

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            flattenPlaceholders(value, nextKey, output);
            continue;
        }

        if (value !== undefined && value !== null) {
            output[nextKey] = String(value);
            if (!prefix) {
                output[key] = String(value);
            }
        }
    }

    return output;
}

function buildPlaceholderMap(): PlaceholderMap {
    const coreConfig = configManager.get<Record<string, unknown>>('core');
    const customPlaceholders = flattenPlaceholders(coreConfig?.placeholders);
    const emojiPlaceholders = Object.fromEntries(
        Object.entries(emojis.getAll()).map(([name, value]) => [`emoji_${name}`, value])
    );

    return {
        ...customPlaceholders,
        ...emojiPlaceholders
    };
}

export function resolveGlobalPlaceholders<T>(obj: T): T {
    const placeholders = buildPlaceholderMap();

    const replace = (target: any): any => {
        if (typeof target === 'string') {
            return target.replace(/%%([a-zA-Z0-9_.-]+)%%/g, (match, key) => {
                const normalizedKey = key.startsWith('placeholder_')
                    ? key.slice('placeholder_'.length)
                    : key;

                return placeholders[normalizedKey] ?? placeholders[key] ?? match;
            });
        }

        if (Array.isArray(target)) {
            return target.map(replace);
        }

        if (target !== null && typeof target === 'object') {
            if (target.constructor !== Object) {
                return target; 
            }

            const res: any = {};
            for (const [key, value] of Object.entries(target)) {
                res[key] = replace(value);
            }
            return res;
        }

        return target;
    };

    return replace(obj);
}

export function interpolateVariables<T>(obj: T, vars?: Record<string, any>): T {
    if (!vars || Object.keys(vars).length === 0) {
        return resolveGlobalPlaceholders(obj);
    }

    const replace = (target: any): any => {
        if (typeof target === "string") {
            const interpolated = target.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
                const val = key.split('.').reduce((o: any, p: string) => o?.[p], vars);
                return val !== undefined ? String(val) : `{{${key}}}`;
            });

            return resolveGlobalPlaceholders(interpolated);
        }
        
        if (Array.isArray(target)) {
            return target.map(replace);
        }
        
        if (target !== null && typeof target === "object") {
            if (target.constructor !== Object) return target;

            const res: any = {};
            for (const [k, v] of Object.entries(target)) {
                res[k] = replace(v);
            }
            return res;
        }
        
        return target;
    };

    return replace(obj);
}

export function sanitizeMarkdownString(str: string | undefined | null, maxLen: number, fallback = "\u200B"): string {
    if (!str || str.trim() === "") return fallback;
    if (str.length <= maxLen) return str;

    let truncated = str.substring(0, maxLen - 3);
    truncated = truncated.replace(/\[[^\]]*\]\([^\)]*$/, "");

    const openBold = (truncated.match(/\*\*/g) || []).length;
    if (openBold % 2 !== 0) {
        truncated = truncated.substring(0, truncated.length - 2);
        truncated += "**";
    }

    return truncated + "...";
}