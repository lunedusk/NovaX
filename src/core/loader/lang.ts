import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { getLogger } from '#core/utils/logger.js';

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
                if (typeof userObj === typeof defaultObj) {
                    return userObj;
                } else {
                    mutations.push(`[Type Mismatch] Reset '${pathTracker}' from ${typeof userObj} back to ${typeof defaultObj}`);
                    return defaultObj;
                }
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
                    mutations.push(`[Obsolete String] Pruned deprecated translation key '${pathTracker === 'root' ? key : `${pathTracker}.${key}`}'`);
                }
            }
        }

        return syncedObj;
    }

    private async atomicWrite(targetPath: string, data: JsonObject): Promise<void> {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        const tempPath = `${targetPath}.${Date.now()}.tmp`;
        
        try {
            const payload = JSON5.stringify(data, null, 4);
            await fs.writeFile(tempPath, payload, 'utf-8');
            await fs.rename(tempPath, targetPath);
        } catch (error) {
            await fs.unlink(tempPath).catch(() => {});
            throw error;
        }
    }

    public async syncPlugin(pluginDir: string, pluginId: string): Promise<void> {
        const sourceLangDir = path.join(pluginDir, 'data', 'configuration', 'lang');

        try {
            const files = await fs.readdir(sourceLangDir).catch(err => {
                if (err.code === 'ENOENT') return null;
                throw err;
            });

            if (!files) return;

            const json5Files = files.filter(f => f.endsWith('.json5'));
            if (json5Files.length === 0) return;

            await fs.mkdir(this.globalLangDir, { recursive: true });

            for (const file of json5Files) {
                const sourcePath = path.join(sourceLangDir, file);
                const targetName = this.formatLangName(pluginId, file);
                const targetPath = path.join(this.globalLangDir, targetName);

                const rawDefault = await fs.readFile(sourcePath, 'utf-8');
                let defaultLang: JsonObject;
                try {
                    defaultLang = JSON5.parse(rawDefault);
                } catch (err) {
                    log.error(`[${pluginId}] Malformed default language schema: ${file}. Skipping sync.`);
                    continue;
                }

                try {
                    const rawUser = await fs.readFile(targetPath, 'utf-8');
                    const userLang = JSON5.parse(rawUser);

                    const mutations: string[] = [];
                    const mergedLang = this.deepSync(defaultLang, userLang, 'root', mutations);

                    if (mutations.length > 0) {
                        await this.atomicWrite(targetPath, mergedLang);
                        log.info(`[${pluginId}] Synced language file ${targetName}. Applied ${mutations.length} updates.`);
                        mutations.forEach(m => log.debug(`  -> ${m}`));
                    }
                } catch (error: unknown) {
                    const err = error as NodeJS.ErrnoException;
                    if (err.code === 'ENOENT') {
                        await this.atomicWrite(targetPath, defaultLang);
                        log.info(`[${pluginId}] Generated fresh global translation: ${targetName}`);
                    } else if (err instanceof SyntaxError) {
                        log.warn(`[${pluginId}] Global translation ${targetName} is corrupted. Creating backup and resetting to defaults.`);
                        await fs.rename(targetPath, `${targetPath}.corrupted.bak`);
                        await this.atomicWrite(targetPath, defaultLang);
                    } else {
                        throw err;
                    }
                }
            }
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`[${pluginId}] Language sync failure: ${err.message}`);
        }
    }

    public async syncAll(): Promise<void> {
        log.info('Initializing Global Language Sync...');

        try {
            const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });

            const syncPromises = entries.map(async (entry) => {
                if (!entry.isDirectory()) return;

                const pluginDir = path.join(this.pluginsDir, entry.name);
                const manifestPath = path.join(pluginDir, 'manifest.json');

                try {
                    const rawManifest = await fs.readFile(manifestPath, 'utf-8');
                    const manifest = JSON.parse(rawManifest);
                    
                    const pluginId = manifest?.id || entry.name;
                    await this.syncPlugin(pluginDir, pluginId);
                } catch (error: unknown) {
                    const err = error as NodeJS.ErrnoException;
                    if (err.code !== 'ENOENT') {
                        log.warn(`[${entry.name}] Failed to read manifest: ${err.message}`);
                    }
                }
            });

            await Promise.all(syncPromises);
            log.info('Global Language Sync complete.');

        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') {
                log.error(`Failed to scan plugins directory: ${err.message}`);
            }
        }
    }
}

export const langLoader = new LangLoader();