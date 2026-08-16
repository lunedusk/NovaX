import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { getLogger } from '#core/utils/logger.js';
import {
    formatIssues,
    langDocumentSchema,
    loadPluginLangRules,
    loadPluginLangSchema,
    validateValue
} from '#core/validation/index.js';

const log = getLogger('LangLoader');
type JsonObject = Record<string, any>;

export class LangLoader {
    private readonly globalLangDir: string;
    private readonly pluginsDir: string;

    constructor(baseDir: string = process.cwd()) {
        this.globalLangDir = path.join(baseDir, 'configuration', 'lang');
        this.pluginsDir = path.join(baseDir, 'plugins');
    }

    private formatLangName(pluginId: string, originalName: string): string {
        const locale = path.basename(originalName, '.json5');
        const safePluginId = pluginId.replace(/[^a-zA-Z0-9_-]/g, '');
        return `${safePluginId}_${locale}.json5`;
    }

    private deepSync(defaultObj: any, userObj: any, pathTracker: string = 'root', mutations: string[] = []): any {
        if (typeof defaultObj !== 'object' || defaultObj === null) {
            if (userObj !== undefined) {
                if (typeof userObj === typeof defaultObj) return userObj;
                mutations.push(`[Type Mismatch] Reset '${pathTracker}' from ${typeof userObj} back to ${typeof defaultObj}`);
                return defaultObj;
            }
            return defaultObj;
        }
        if (Array.isArray(defaultObj)) {
            if (Array.isArray(userObj)) return userObj;
            mutations.push(`[Type Mismatch] Reset '${pathTracker}' to default Array`);
            return [...defaultObj];
        }
        const syncedObj: JsonObject = {};
        for (const key of Object.keys(defaultObj)) {
            const currentPath = pathTracker === 'root' ? key : `${pathTracker}.${key}`;
            if (userObj && Object.prototype.hasOwnProperty.call(userObj, key)) {
                syncedObj[key] = this.deepSync(defaultObj[key], userObj[key], currentPath, mutations);
            } else {
                mutations.push(`[Missing Translation] Added new default string '${currentPath}'`);
                syncedObj[key] = defaultObj[key];
            }
        }
        if (userObj && typeof userObj === 'object' && !Array.isArray(userObj)) {
            for (const key of Object.keys(userObj)) {
                if (!Object.prototype.hasOwnProperty.call(defaultObj, key)) {
                    mutations.push(`[Obsolete String] Pruned deprecated translation key '${pathTracker === 'root' ? key : pathTracker + '.' + key}'`);
                }
            }
        }
        return syncedObj;
    }

    private async atomicWrite(targetPath: string, data: JsonObject): Promise<void> {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        const tempPath = `${targetPath}.${Date.now()}.tmp`;
        try {
            await fs.writeFile(tempPath, JSON5.stringify(data, null, 4), 'utf-8');
            await fs.rename(tempPath, targetPath);
        } catch (error) {
            await fs.unlink(tempPath).catch(() => {});
            throw error;
        }
    }

    private async validateLang(pluginId: string, filePath: string, data: unknown, locale?: string) {
        const loc = locale || path.basename(filePath, '.json5');
        const schema = await loadPluginLangSchema(pluginId, loc);
        const rules = await loadPluginLangRules(pluginId, loc);
        const result = await validateValue(data, {
            kind: 'lang',
            filePath,
            pluginId,
            name: path.basename(filePath),
            locale: loc
        }, schema, rules);
        if (!result.ok) return { ok: false as const, message: formatIssues(result.issues) };
        return { ok: true as const, data: result.data as JsonObject };
    }

    public async syncPlugin(pluginDir: string, pluginId: string): Promise<void> {
        const sourceLangDir = path.join(pluginDir, 'data', 'configuration', 'lang');
        try {
            const files = await fs.readdir(sourceLangDir).catch(err => err.code === 'ENOENT' ? null : Promise.reject(err));
            if (!files) return;
            const json5Files = files.filter((f: string) => f.endsWith('.json5'));
            if (!json5Files.length) return;
            await fs.mkdir(this.globalLangDir, { recursive: true });

            for (const file of json5Files) {
                const sourcePath = path.join(sourceLangDir, file);
                const targetName = this.formatLangName(pluginId, file);
                const targetPath = path.join(this.globalLangDir, targetName);
                let defaultLang: JsonObject;
                try {
                    defaultLang = JSON5.parse(await fs.readFile(sourcePath, 'utf-8'));
                } catch {
                    log.error(`[${pluginId}] Malformed default language schema: ${file}. Skipping sync.`);
                    continue;
                }
                const defOk = await this.validateLang(pluginId, sourcePath, defaultLang, path.basename(file, '.json5'));
                if (!defOk.ok) {
                    log.error(`[${pluginId}] Default lang failed validation (${file}): ${defOk.message}`);
                    continue;
                }
                defaultLang = defOk.data;

                try {
                    const userLang = JSON5.parse(await fs.readFile(targetPath, 'utf-8'));
                    const mutations: string[] = [];
                    let merged = this.deepSync(defaultLang, userLang, 'root', mutations);
                    const mergedOk = await this.validateLang(pluginId, targetPath, merged, path.basename(file, '.json5'));
                    if (!mergedOk.ok) {
                        log.warn(`[${pluginId}] Merged lang invalid (${targetName}): ${mergedOk.message}`);
                        continue;
                    }
                    merged = mergedOk.data;
                    if (mutations.length > 0) {
                        await this.atomicWrite(targetPath, merged);
                        log.info(`[${pluginId}] Synced language file ${targetName}. Applied ${mutations.length} updates.`);
                    }
                } catch (error: unknown) {
                    const err = error as NodeJS.ErrnoException;
                    if (err.code === 'ENOENT') {
                        await this.atomicWrite(targetPath, defaultLang);
                        log.info(`[${pluginId}] Generated fresh global translation: ${targetName}`);
                    } else if (error instanceof SyntaxError) {
                        log.warn(`[${pluginId}] Global translation ${targetName} corrupted; backup and reset.`);
                        await fs.rename(targetPath, `${targetPath}.corrupted.bak`);
                        await this.atomicWrite(targetPath, defaultLang);
                    } else throw error;
                }
            }
        } catch (error: unknown) {
            log.error(`[${pluginId}] Language sync failure: ${(error as Error).message}`);
        }
    }

    public async syncAll(): Promise<void> {
        log.info('Initializing Global Language Sync...');
        try {
            const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
            await Promise.all(entries.map(async (entry) => {
                if (!entry.isDirectory()) return;
                const pluginDir = path.join(this.pluginsDir, entry.name);
                try {
                    const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, 'manifest.json'), 'utf-8'));
                    await this.syncPlugin(pluginDir, manifest?.id || entry.name);
                } catch (error: unknown) {
                    const err = error as NodeJS.ErrnoException;
                    if (err.code !== 'ENOENT') log.warn(`[${entry.name}] Failed to read manifest: ${err.message}`);
                }
            }));
            log.info('Global Language Sync complete.');
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') log.error(`Failed to scan plugins directory: ${err.message}`);
        }
    }
}

export const langLoader = new LangLoader();
