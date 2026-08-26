import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RulesValidateFn } from './types.js';
import type { AnyZodSchema } from './run.js';
import type { IHeart } from '#core/heart/index.js';
import { getRulesHeart } from './rulesContext.js';

export function inferPluginIdFromConfigName(configName: string): string | null {
    if (!configName) return null;
    if (!configName.includes('-')) return configName;
    return configName.split('-')[0] || null;
}

export function configStemFromGlobalName(configName: string, pluginId: string | null): string {
    if (!pluginId) return configName;
    if (configName === pluginId) return 'config';
    const prefix = pluginId + '-';
    if (configName.startsWith(prefix)) {
        const rest = configName.slice(prefix.length);
        return rest || 'config';
    }
    return configName;
}

/** @deprecated alias */
export function configSuffixFromName(configName: string, pluginId: string | null): string {
    const stem = configStemFromGlobalName(configName, pluginId);
    return stem === 'config' ? '' : stem;
}

function pluginDirCandidates(pluginId: string): string[] {
    return [
        path.join(process.cwd(), 'plugins', pluginId),
        path.join(process.cwd(), 'src', 'plugins', pluginId)
    ];
}

function existing(...files: string[]): string | null {
    for (const f of files) {
        if (fs.existsSync(f)) return f;
    }
    return null;
}

function assertDataCodePath(full: string): void {
    const normalized = full.replace(/\\/g, '/');
    const dataIdx = normalized.lastIndexOf('/data/');
    if (dataIdx === -1) return;
    const after = normalized.slice(dataIdx + '/data/'.length);
    if (!after.startsWith('schema/') && !after.startsWith('rules/')) {
        throw new Error(`Refusing to load executable module outside data/schema or data/rules: ${full}`);
    }
}

async function importModule(full: string): Promise<Record<string, unknown> | null> {
    assertDataCodePath(full);
    try {
        return (await import(pathToFileURL(full).href + `?t=${Date.now()}`)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function asZod(mod: Record<string, unknown> | null): AnyZodSchema | null {
    if (!mod) return null;
    const schema = mod.configSchema ?? mod.schema ?? mod.default;
    if (schema && typeof (schema as AnyZodSchema).safeParse === 'function') {
        return schema as AnyZodSchema;
    }
    return null;
}

function asRules(mod: any, heart?: IHeart | null): RulesValidateFn | null {
    if (!mod) return null;
    if (typeof mod.createRules === 'function') {
        const h = heart ?? getRulesHeart();
        if (h) {
            const built = mod.createRules(h);
            if (typeof built === 'function') {
                return (data, ctx) => built(data, ctx, h);
            }
        }
    }
    const fn = mod.validate ?? mod.default;
    if (typeof fn !== 'function') return null;
    const h = heart ?? getRulesHeart();
    return (data, ctx) => fn(data, ctx, h);
}

/**
 * @param pluginId plugin id
 * @param configName global basename (e.g. permissions-levels) OR local stem (e.g. levels)
 * @param fromLocalStem if true, configName is already the file stem under data/configuration/
 */
export async function loadPluginConfigSchema(
    pluginId: string | null,
    configName?: string,
    fromLocalStem = false
): Promise<AnyZodSchema | null> {
    if (!pluginId) return null;

    const stem = fromLocalStem
        ? (configName && configName.replace(/\.json5$/i, '')) || 'config'
        : configStemFromGlobalName(configName ?? pluginId, pluginId);

    for (const dir of pluginDirCandidates(pluginId)) {
        const base = path.join(dir, 'data', 'schema', 'config');
        const hit = existing(
            path.join(base, `${stem}.schema.js`),
            path.join(base, `${stem}.schema.mjs`),
            path.join(base, `${stem}.schema.ts`),
            // primary aliases
            ...(stem === 'config'
                ? [
                    path.join(base, 'default.schema.js'),
                    path.join(base, 'default.schema.mjs'),
                    path.join(base, 'default.schema.ts')
                ]
                : [])
        );
        if (hit) {
            const schema = asZod(await importModule(hit));
            if (schema) return schema;
        }
    }
    return null;
}

export async function loadPluginConfigRules(
    pluginId: string | null,
    configName?: string,
    fromLocalStem = false
): Promise<RulesValidateFn | null> {
    if (!pluginId) return null;

    const stem = fromLocalStem
        ? (configName && configName.replace(/\.json5$/i, '')) || 'config'
        : configStemFromGlobalName(configName ?? pluginId, pluginId);

    for (const dir of pluginDirCandidates(pluginId)) {
        const base = path.join(dir, 'data', 'rules', 'config');
        const hit = existing(
            path.join(base, `${stem}.rules.js`),
            path.join(base, `${stem}.rules.mjs`),
            path.join(base, `${stem}.rules.ts`),
            ...(stem === 'config'
                ? [
                    path.join(base, 'default.rules.js'),
                    path.join(base, 'default.rules.mjs'),
                    path.join(base, 'default.rules.ts')
                ]
                : [])
        );
        if (hit) {
            const rules = asRules(await importModule(hit));
            if (rules) return rules;
        }
    }
    return null;
}

/**
 * Lang schema/rules per locale, with default.* fallback.
 * @param locale e.g. en — from `{pluginId}_{locale}.json5` or source `lang/en.json5`
 */
export async function loadPluginLangSchema(
    pluginId: string | null,
    locale?: string | null
): Promise<AnyZodSchema | null> {
    if (!pluginId) return null;
    const loc = (locale || 'default').toLowerCase();

    for (const dir of pluginDirCandidates(pluginId)) {
        const base = path.join(dir, 'data', 'schema', 'lang');
        const hit = existing(
            path.join(base, `${loc}.schema.js`),
            path.join(base, `${loc}.schema.mjs`),
            path.join(base, `${loc}.schema.ts`),
            path.join(base, 'default.schema.js'),
            path.join(base, 'default.schema.mjs'),
            path.join(base, 'default.schema.ts')
        );
        if (hit) {
            const schema = asZod(await importModule(hit));
            if (schema) return schema;
        }
    }
    return null;
}

export async function loadPluginLangRules(
    pluginId: string | null,
    locale?: string | null
): Promise<RulesValidateFn | null> {
    if (!pluginId) return null;
    const loc = (locale || 'default').toLowerCase();

    for (const dir of pluginDirCandidates(pluginId)) {
        const base = path.join(dir, 'data', 'rules', 'lang');
        const hit = existing(
            path.join(base, `${loc}.rules.js`),
            path.join(base, `${loc}.rules.mjs`),
            path.join(base, `${loc}.rules.ts`),
            path.join(base, 'default.rules.js'),
            path.join(base, 'default.rules.mjs'),
            path.join(base, 'default.rules.ts')
        );
        if (hit) {
            const rules = asRules(await importModule(hit));
            if (rules) return rules;
        }
    }
    return null;
}
