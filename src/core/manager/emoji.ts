import fs from 'node:fs/promises';
import path from 'node:path';
import { FileWatcher, type WatchEvent } from '#core/watcher/index.js';
import { getLogger } from '#core/utils/logger.js';
import { registerEmojiSource } from '#core/placeholder/index.js';

const log = getLogger('EmojiManager');

export class EmojiManager {
    private static readonly EMOJI_REGEX = /%%emoji_([a-zA-Z0-9_]+)%%/g;
    private cache = new Map<string, string>();
    private readonly liveRecord: Record<string, string> = {};
    
    private readonly filePath: string;
    private watcher: FileWatcher | null = null;
    private isReloading = false;

    constructor(targetPath?: string) {
        this.filePath = targetPath ? path.resolve(targetPath) : path.join(process.cwd(), '.data', 'emojis.json');
    }

    public async init(hotReload: boolean = false): Promise<void> {
        log.info('Initializing Emoji Manager...');
        await this.load();

        if (hotReload) {
            const dir = path.dirname(this.filePath);
            const fileName = path.basename(this.filePath);
            
            this.watcher = new FileWatcher(dir, {
                includePatterns: [fileName],
                ignoreDirectories: ['.git', '__pycache__', 'node_modules', '.venv', 'dist']
            });
            
            this.watcher.on('events', async (events: WatchEvent[]) => {
                for (const event of events) {
                    if (event.type === 'deleted') {
                        this.applyAtomicSwap(new Map());
                        log.warn(`${fileName} was deleted. Emoji cache cleared.`);
                    } else {
                        await this.load();
                    }
                }
            });
            
            this.watcher.start();
            log.info('Emoji Manager hot-reload active.');
        }
    }

    public async reload(): Promise<boolean> {
        log.info('Force reloading emoji configuration...');
        return await this.load();
    }

    private async load(): Promise<boolean> {
        if (this.isReloading) return false;
        this.isReloading = true;

        try {
            const rawData = await fs.readFile(this.filePath, 'utf-8');
            const parsed: Record<string, string> = JSON.parse(rawData);

            const newCache = new Map<string, string>(Object.entries(parsed));
            this.applyAtomicSwap(newCache);

            log.debug(`Loaded ${this.cache.size} custom emojis.`);
            return true;

        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            
            if (err.code === 'ENOENT') {
                log.warn(`Emoji file not found at ${this.filePath}. Cache empty.`);
                this.applyAtomicSwap(new Map());
            } else {
                log.error(`Failed to parse emoji.json: ${err.message}`);
            }
            return false;
        } finally {
            this.isReloading = false;
        }
    }

    private applyAtomicSwap(newMap: Map<string, string>): void {
        this.cache = newMap;
        
        for (const key in this.liveRecord) {
            if (Object.prototype.hasOwnProperty.call(this.liveRecord, key)) {
                delete this.liveRecord[key];
            }
        }
        Object.assign(this.liveRecord, Object.fromEntries(this.cache));
    }

    public get(key: string): string | null {
        return this.cache.get(key) || null;
    }

    public parse(text: string): string {
        if (!text) return text;
        
        return text.replace(EmojiManager.EMOJI_REGEX, (match, key) => {
            return this.cache.get(key) ?? match; 
        });
    }

    public getAll(): Readonly<Record<string, string>> {
        return this.liveRecord;
    }

    public dumpSnapshot(): Record<string, string> {
        return { ...Object.fromEntries(this.cache) };
    }

    public applySnapshot(map: Record<string, string>): void {
        const newCache = new Map<string, string>();
        for (const [key, value] of Object.entries(map)) {
            if (typeof value === 'string') {
                newCache.set(key, value);
            }
        }
        this.applyAtomicSwap(newCache);
        log.info(`Emoji snapshot applied (${this.cache.size} entries, no disk I/O)`);
    }
}

export const emojis = new EmojiManager();

registerEmojiSource(() => emojis.getAll());
