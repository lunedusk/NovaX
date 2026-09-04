import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { HttpError } from './http.js';

export interface ConfigSchemaField {
    key: string;
    type: string;
    default: unknown;
}

interface ConfigManagerLike {
    get<T = Record<string, unknown>>(name: string): T | null;
    getRaw?<T = Record<string, unknown>>(name: string): T | null;
    getRedacted?<T = Record<string, unknown>>(name: string): T | null;
    reloadFile(name: string): Promise<boolean>;
}

interface LanguageManagerLike {
    reloadFile(namespace: string, locale?: string): Promise<boolean>;
    reloadAll(): Promise<boolean>;
    wipeCache(locale?: string): void;
    getRaw?(namespace: string, locale?: string): Record<string, unknown> | null;
    getRedacted?(namespace: string, locale?: string): Record<string, unknown> | null;
}

const CWD = process.cwd();
const CONFIG_DIR = path.join(CWD, 'configuration');
const LANG_DIR = path.join(CWD, 'configuration', 'lang');
const PLUGINS_DIR = path.join(CWD, 'plugins');

function configFileKey(pluginId: string): string {
    return pluginId;
}

function configFilePath(pluginId: string): string {
    return path.join(CONFIG_DIR, `${configFileKey(pluginId)}.json5`);
}

function pluginDefaultConfigPath(pluginId: string): string {
    return path.join(PLUGINS_DIR, pluginId, 'data', 'configuration', 'config.json5');
}

function langFilePath(pluginId: string, locale: string): string {
    return path.join(LANG_DIR, `${pluginId}_${locale}.json5`);
}

async function realConfigManager(): Promise<ConfigManagerLike> {
    const mod = (await import('#core/manager/config.js')) as { configManager: ConfigManagerLike };
    if (!mod.configManager) throw new HttpError(500, 'internal', 'configManager unavailable.');
    return mod.configManager;
}

async function realLangManager(): Promise<LanguageManagerLike> {
    const mod = (await import('#core/manager/lang.js')) as { i18n: LanguageManagerLike };
    if (!mod.i18n) throw new HttpError(500, 'internal', 'i18n manager unavailable.');
    return mod.i18n;
}

async function fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
}

export async function getPluginConfig(pluginId: string): Promise<Record<string, unknown>> {
    const mgr = await realConfigManager();
    const key = configFileKey(pluginId);
    const cfg =
        typeof mgr.getRaw === 'function'
            ? mgr.getRaw<Record<string, unknown>>(key)
            : mgr.get<Record<string, unknown>>(key);
    if (cfg === null) {
        throw new HttpError(
            404,
            'not_found',
            `No live config loaded for plugin ${pluginId} (expected ${key}.json5).`,
        );
    }
    return cfg as Record<string, unknown>;
}

export async function getPluginConfigRedacted(pluginId: string): Promise<Record<string, unknown>> {
    const mgr = await realConfigManager();
    const key = configFileKey(pluginId);
    if (typeof mgr.getRedacted === 'function') {
        const cfg = mgr.getRedacted<Record<string, unknown>>(key);
        if (cfg === null) {
            throw new HttpError(404, 'not_found', `No live config loaded for plugin ${pluginId}.`);
        }
        return cfg as Record<string, unknown>;
    }
    return getPluginConfig(pluginId);
}

export async function setPluginConfig(
    pluginId: string,
    newConfig: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(configFilePath(pluginId), JSON5.stringify(newConfig, null, 4), 'utf-8');
    const mgr = await realConfigManager();
    const reloaded = await mgr.reloadFile(configFileKey(pluginId));
    if (!reloaded) {
        throw new HttpError(
            500,
            'internal',
            `Wrote config file but ConfigManager.reloadFile() failed for ${pluginId}. Check server logs.`,
        );
    }
    return getPluginConfig(pluginId);
}

export async function resetPluginConfig(pluginId: string): Promise<Record<string, unknown>> {
    const defaultPath = pluginDefaultConfigPath(pluginId);
    if (!(await fileExists(defaultPath))) {
        throw new HttpError(
            404,
            'not_found',
            `No default config.json5 found for plugin ${pluginId} at ${defaultPath}.`,
        );
    }
    const raw = await fs.readFile(defaultPath, 'utf-8');
    const defaults = JSON5.parse(raw) as Record<string, unknown>;
    return setPluginConfig(pluginId, defaults);
}

export async function getPluginConfigSchema(pluginId: string): Promise<ConfigSchemaField[]> {
    const defaultPath = pluginDefaultConfigPath(pluginId);
    if (!(await fileExists(defaultPath))) return [];
    const raw = await fs.readFile(defaultPath, 'utf-8');
    const defaults = JSON5.parse(raw) as Record<string, unknown>;
    return Object.entries(defaults).map(([key, value]) => ({
        key,
        type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
        default: value,
    }));
}

export async function listPluginLocales(pluginId: string): Promise<string[]> {
    let files: string[];
    try {
        files = await fs.readdir(LANG_DIR);
    } catch {
        return [];
    }
    const prefix = `${pluginId}_`;
    return files
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json5'))
        .map((f) => f.slice(prefix.length, -'.json5'.length));
}

export async function getPluginLocale(
    pluginId: string,
    locale: string,
): Promise<Record<string, unknown> | null> {
    const lang = await realLangManager();
    if (typeof lang.getRaw === 'function') {
        const fromRegistry = lang.getRaw(pluginId, locale);
        if (fromRegistry !== null) return fromRegistry;
    }
    try {
        const raw = await fs.readFile(langFilePath(pluginId, locale), 'utf-8');
        return JSON5.parse(raw) as Record<string, unknown>;
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
    }
}

export async function getPluginLocaleRedacted(
    pluginId: string,
    locale: string,
): Promise<Record<string, unknown> | null> {
    const lang = await realLangManager();
    if (typeof lang.getRedacted === 'function') {
        return lang.getRedacted(pluginId, locale);
    }
    return getPluginLocale(pluginId, locale);
}

async function writeLocaleFile(
    pluginId: string,
    locale: string,
    content: Record<string, unknown>,
    mode: 'create' | 'update',
): Promise<void> {
    const filePath = langFilePath(pluginId, locale);
    const exists = await fileExists(filePath);
    if (mode === 'update' && !exists) {
        throw new HttpError(
            404,
            'not_found',
            `Locale ${locale} does not exist for ${pluginId}. Use POST to create it.`,
        );
    }
    if (mode === 'create' && exists) {
        throw new HttpError(
            409,
            'conflict',
            `Locale ${locale} already exists for ${pluginId}. Use PUT to update it.`,
        );
    }

    await fs.mkdir(LANG_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON5.stringify(content, null, 4), 'utf-8');

    const lang = await realLangManager();
    const reloaded = await lang.reloadFile(pluginId, locale);
    if (!reloaded) {
        throw new HttpError(
            500,
            'internal',
            `Wrote locale file but LanguageManager.reloadFile() failed for ${pluginId}/${locale}.`,
        );
    }
}

export async function updatePluginLocale(
    pluginId: string,
    locale: string,
    content: Record<string, unknown>,
): Promise<void> {
    await writeLocaleFile(pluginId, locale, content, 'update');
}

export async function createPluginLocale(
    pluginId: string,
    locale: string,
    content: Record<string, unknown>,
): Promise<void> {
    await writeLocaleFile(pluginId, locale, content, 'create');
}

export async function deletePluginLocale(pluginId: string, locale: string): Promise<void> {
    const filePath = langFilePath(pluginId, locale);
    try {
        await fs.unlink(filePath);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new HttpError(404, 'not_found', `Locale ${locale} not found for ${pluginId}.`);
        }
        throw e;
    }
    const lang = await realLangManager();
    lang.wipeCache(locale);
    await lang.reloadAll();
}
