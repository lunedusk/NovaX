import type { RulesValidateFn } from '#core/validation/types.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validateLayoutJson(label: string, raw: string, issues: string[]): void {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        issues.push(`layouts.${label}: not valid JSON`);
        return;
    }
    if (!isPlainObject(parsed)) {
        issues.push(`layouts.${label}: root must be an object`);
        return;
    }
    const components = parsed.components;
    if (!Array.isArray(components) || components.length === 0) {
        issues.push(`layouts.${label}: components must be a non-empty array`);
        return;
    }
    const first = components[0] as Record<string, unknown>;
    if (!first || first.type !== 'container') {
        issues.push(`layouts.${label}: components[0] should be type "container"`);
    }
}

export const validate: RulesValidateFn = (data) => {
    if (!isPlainObject(data)) return true;

    const issues: string[] = [];

    const commands = data.commands;
    if (!isPlainObject(commands) || !isPlainObject(commands.permissions)) {
        issues.push('commands.permissions: required object namespace');
    } else {
        const p = commands.permissions as Record<string, unknown>;
        for (const key of ['description', 'titles', 'messages', 'roles', 'bits', 'cache', 'resolve'] as const) {
            if (p[key] === undefined) {
                issues.push(`commands.permissions.${key}: missing (command UI expects this)`);
            }
        }
        if (isPlainObject(p.titles)) {
            for (const t of ['roles', 'bits', 'resolve', 'cache', 'denied', 'system'] as const) {
                if (typeof p.titles[t] !== 'string') {
                    issues.push(`commands.permissions.titles.${t}: expected string`);
                }
            }
        }
    }

    const layouts = data.layouts;
    if (!isPlainObject(layouts)) {
        issues.push('layouts: required (containerSuccess / containerError / containerInfo)');
    } else {
        for (const key of ['containerSuccess', 'containerError', 'containerInfo'] as const) {
            const raw = layouts[key];
            if (typeof raw !== 'string' || !raw.trim()) {
                issues.push(`layouts.${key}: required non-empty JSON string`);
                continue;
            }
            validateLayoutJson(key, raw, issues);
        }
    }

    if (issues.length === 0) return true;
    return issues;
};

export default validate;