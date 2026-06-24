import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { FileWatcher, type WatchEvent } from '#core/watcher/index.js';
import { getLogger } from '#core/utils/logger.js';
import { resolveGlobalPlaceholders } from '#core/builders/helpers/string.js';

const log = getLogger('ConfigManager');

export class ConfigManager {
    private cache = new Map<string, unknown>();
    private readonly liveConfigs = new Map<string, Record<string, any>>();
    private readonly targetDir: string;
    private watcher: FileWatcher | null = null;
    private isReloading = false;

    constructor(targetDir?: string) {
        this.targetDir = targetDir ? path.resolve(targetDir) : path.join(process.cwd(), 'configuration');
    }

    private resolveObjectPlaceholders(obj: any): any {
        if (!obj) return obj;
        
        if (typeof obj === 'string') {
            return resolveGlobalPlaceholders(obj);
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.resolveObjectPlaceholders(item));
        }
        
        if (typeof obj === 'object') {
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    obj[key] = this.resolveObjectPlaceholders(obj[key]);
                }
            }
        }
        return obj;
    }

    public async init(hotReload: boolean = false): Promise<void> {
        log.info('Initializing Configuration Manager...');
        
        await fs.mkdir(this.targetDir, { recursive: true });
        await this.loadAll();

        if (hotReload) {
            this.watcher = new FileWatcher(this.targetDir, { includePatterns: ['*.json5'] });
            
            this.watcher.on('events', (events: WatchEvent[]) => this.handleWatchEvents(events).catch(err => {
                log.error(`Fatal error in Config Watcher: ${(err as Error).message}`);
            }));
            
            this.watcher.start();
            log.info('Configuration Manager hot-reload active.');
        }
    }

    private async handleWatchEvents(events: WatchEvent[]): Promise<void> {
        for (const event of events) {
            const name = path.basename(event.path, '.json5');
            
            if (event.type === 'deleted') {
                this.cache.delete(name);
                const liveRef = this.liveConfigs.get(name);
                if (liveRef) {
                    for (const key in liveRef) {
                        if (Object.prototype.hasOwnProperty.call(liveRef, key)) delete liveRef[key];
                    }
                }
                log.info(`Unloaded configuration: [${name}]`);
            } else {
                await this.reloadFile(name);
            }
        }
    }

    public async reloadAll(): Promise<boolean> {
        log.info('Force reloading all configurations from disk...');
        return await this.loadAll();
    }

    public async reloadFile(name: string): Promise<boolean> {
        const filePath = path.join(this.targetDir, `${name}.json5`);
        
        try {
            const rawContent = await fs.readFile(filePath, 'utf-8');
            let parsed = JSON5.parse(rawContent);

            parsed = this.resolveObjectPlaceholders(parsed);

            this.cache.set(name, parsed);
            this.updateLiveReference(name, parsed);
            
            log.debug(`Successfully reloaded configuration: [${name}.json5]`);
            return true;

        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'ENOENT') {
                log.error(`Cannot reload config [${name}]: File does not exist.`);
            } else {
                log.error(`Failed to parse config file [${name}.json5]: ${err.message}`);
            }
            return false;
        }
    }

    public getLoadedConfigs(): string[] {
        return Array.from(this.cache.keys());
    }

    private async loadAll(): Promise<boolean> {
        if (this.isReloading) return false;
        this.isReloading = true;

        try {
            const entries = await fs.readdir(this.targetDir, { withFileTypes: true });
            const newCache = new Map<string, unknown>();
            let loadedCount = 0;

            for (const entry of entries) {
                if (entry.isDirectory() || !entry.name.endsWith('.json5')) continue;

                const configName = entry.name.replace('.json5', '');
                try {
                    const rawContent = await fs.readFile(path.join(this.targetDir, entry.name), 'utf-8');
                    let parsed = JSON5.parse(rawContent);
                    
                    parsed = this.resolveObjectPlaceholders(parsed);
                    
                    newCache.set(configName, parsed);
                    this.updateLiveReference(configName, parsed);
                    loadedCount++;
                } catch (parseError: unknown) {
                    const err = parseError instanceof Error ? parseError : new Error(String(parseError));
                    log.error(`Failed to parse config file [${entry.name}]: ${err.message}`);
                }
            }

            this.cache = newCache;
            log.info(`Successfully loaded ${loadedCount} configuration files.`);
            return true;

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Critical failure reading configurations: ${err.message}`);
            return false;
        } finally {
            this.isReloading = false;
        }
    }

    private updateLiveReference(name: string, newData: any): void {
        if (!this.liveConfigs.has(name)) {
            this.liveConfigs.set(name, {});
        }
        const currentRef = this.liveConfigs.get(name)!;
        this.deepMutate(currentRef, newData);
    }

    private deepMutate(target: any, source: any): void {
        for (const key in target) {
            if (Object.prototype.hasOwnProperty.call(target, key) && !(key in source)) {
                delete target[key];
            }
        }
        for (const key in source) {
            if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
            
            const sourceVal = source[key];
            const targetVal = target[key];

            if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
                if (!targetVal || typeof targetVal !== 'object' || Array.isArray(targetVal)) {
                    target[key] = {};
                }
                this.deepMutate(target[key], sourceVal);
            } else {
                target[key] = sourceVal;
            }
        }
    }

    public get<T = Record<string, unknown>>(name: string): Readonly<T> | null {
        if (!this.cache.has(name)) return null;
        if (!this.liveConfigs.has(name)) {
            this.liveConfigs.set(name, {});
        }
        return this.liveConfigs.get(name) as unknown as Readonly<T>;
    }

    public getStrict<T = Record<string, unknown>>(name: string): Readonly<T> {
        const config = this.get<T>(name);
        if (!config) {
            throw new Error(`Required configuration [${name}.json5] is missing or failed to parse.`);
        }
        return config;
    }

    public has(name: string): boolean {
        return this.cache.has(name);
    }
}

export const configManager = new ConfigManager();