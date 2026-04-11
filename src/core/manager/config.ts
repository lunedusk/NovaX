import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { FileWatcher, type WatchEvent } from '#core/watcher/index.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('ConfigManager');

export class ConfigManager {
    private cache = new Map<string, unknown>();
    private readonly targetDir: string;
    private watcher: FileWatcher | null = null;
    
    private isReloading = false;

    constructor(targetDir?: string) {
        this.targetDir = targetDir ? path.resolve(targetDir) : path.join(process.cwd(), 'configuration');
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
            const parsed = JSON5.parse(rawContent);

            this.cache.set(name, this.deepFreeze(parsed));
            
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
                    const parsed = JSON5.parse(rawContent);
                    
                    newCache.set(configName, this.deepFreeze(parsed));
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

    private deepFreeze<T extends object>(obj: T): Readonly<T> {
        const propNames = Object.getOwnPropertyNames(obj);
        for (const name of propNames) {
            const value = (obj as any)[name];
            if (value && typeof value === 'object') {
                this.deepFreeze(value);
            }
        }
        return Object.freeze(obj);
    }

    public get<T = Record<string, unknown>>(name: string): Readonly<T> | null {
        const config = this.cache.get(name);
        if (!config) return null;
        return config as Readonly<T>;
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