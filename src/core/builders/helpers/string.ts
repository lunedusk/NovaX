export function interpolateVariables<T>(obj: T, vars?: Record<string, any>): T {
    if (!vars || Object.keys(vars).length === 0) return obj;

    const replace = (target: any): any => {
        if (typeof target === "string") {
            return target.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
                const val = key.split('.').reduce((o: any, p: string) => o?.[p], vars);
                return val !== undefined ? String(val) : `{{${key}}}`;
            });
        }
        if (Array.isArray(target)) return target.map(replace);
        if (target !== null && typeof target === "object") {
            const res: any = {};
            for (const [k, v] of Object.entries(target)) res[k] = replace(v);
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