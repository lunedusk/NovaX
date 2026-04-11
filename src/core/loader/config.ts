import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('ConfigLoader');

type JsonObject = Record<string, any>;

export class ConfigLoader {
    private readonly globalConfigDir: string;
    private readonly pluginsDir: string;

    constructor(baseDir: string = process.cwd()) {
        this.globalConfigDir = path.join(baseDir, 'configuration');
        this.pluginsDir = path.join(baseDir, 'plugins');
    }

    private formatConfigName(pluginId: string, originalName: string): string {
        const baseName = path.basename(originalName, '.json5');
        
        let cleanedName = baseName
            .replace(/(?:^|[-_])config(?:[-_]|$)/gi, '-')
            .replace(/[-_]+/g, '-')
            .replace(/^-|-$/g, '');
        
        if (!cleanedName) {
            return `${pluginId}.json5`;
        }
        
        return `${pluginId}-${cleanedName}.json5`;
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
                mutations.push(`[Missing Key] Added missing default key '${currentPath}'`);
                syncedObj[key] = defaultObj[key];
            }
        }

        if (userObj && typeof userObj === 'object' && !Array.isArray(userObj)) {
            for (const key of Object.keys(userObj)) {
                if (!Object.prototype.hasOwnProperty.call(defaultObj, key)) {
                    mutations.push(`[Obsolete Key] Pruned deprecated key '${pathTracker === 'root' ? key : `${pathTracker}.${key}`}'`);
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
        const sourceConfigDir = path.join(pluginDir, 'data', 'configuration');

        try {
            const files = await fs.readdir(sourceConfigDir).catch(err => {
                if (err.code === 'ENOENT') return null;
                throw err;
            });

            if (!files) return;

            const json5Files = files.filter(f => f.endsWith('.json5'));
            if (json5Files.length === 0) return;

            await fs.mkdir(this.globalConfigDir, { recursive: true });

            for (const file of json5Files) {
                const sourcePath = path.join(sourceConfigDir, file);
                const targetName = this.formatConfigName(pluginId, file);
                const targetPath = path.join(this.globalConfigDir, targetName);

                const rawDefault = await fs.readFile(sourcePath, 'utf-8');
                let defaultConfig: JsonObject;
                try {
                    defaultConfig = JSON5.parse(rawDefault);
                } catch (err) {
                    log.error(`[${pluginId}] Malformed default schema: ${file}. Skipping sync.`);
                    continue;
                }

                try {
                    const rawUser = await fs.readFile(targetPath, 'utf-8');
                    const userConfig = JSON5.parse(rawUser);

                    const mutations: string[] = [];
                    const mergedConfig = this.deepSync(defaultConfig, userConfig, 'root', mutations);

                    if (mutations.length > 0) {
                        await this.atomicWrite(targetPath, mergedConfig);
                        log.info(`[${pluginId}] synced ${targetName}. Applied ${mutations.length} updates.`);
                        mutations.forEach(m => log.debug(`  -> ${m}`));
                    }
                } catch (err: any) {
                    if (err.code === 'ENOENT') {
                        await this.atomicWrite(targetPath, defaultConfig);
                        log.info(`[${pluginId}] Generated fresh global config: ${targetName}`);
                    } else if (err instanceof SyntaxError) {
                        log.warn(`[${pluginId}] User config ${targetName} is corrupted. Creating backup and resetting to defaults.`);
                        await fs.rename(targetPath, `${targetPath}.corrupted.bak`);
                        await this.atomicWrite(targetPath, defaultConfig);
                    } else {
                        throw err;
                    }
                }
            }
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`[${pluginId}] Config sync failure: ${err.message}`);
        }
    }

    public async syncAll(): Promise<void> {
        log.info('Initializing Global Configuration Sync...');

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
                } catch (err: any) {
                    if (err.code !== 'ENOENT') {
                        log.warn(`[${entry.name}] Failed to read manifest: ${err.message}`);
                    }
                }
            });

            await Promise.all(syncPromises);
            log.info('Global Configuration Sync complete.');

        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') {
                log.error(`Failed to scan plugins directory: ${err.message}`);
            }
        }
    }
}

export const configLoader = new ConfigLoader();