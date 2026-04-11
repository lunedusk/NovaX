import chokidar, { FSWatcher } from 'chokidar';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('FileWatcher');

export type EventType = 'created' | 'modified' | 'deleted' | 'moved';

export interface WatchEvent {
    type: EventType;
    path: string;
    isDirectory: boolean;
    timestamp: number;
    oldPath?: string;
}

export interface WatcherConfig {
    recursive?: boolean;
    debounceMs?: number;
    batchWindowMs?: number;
    includePatterns?: string[];
    ignoreDirectories?: string[];
    allowPollingFallback?: boolean;
}

export class FileWatcher extends EventEmitter {
    private readonly targetPath: string;
    private readonly config: Required<WatcherConfig>;
    private watcher: FSWatcher | null = null;
    
    private batch: WatchEvent[] = [];
    private debounceMap = new Map<string, number>();
    private flushTimer: NodeJS.Timeout | null = null;

    constructor(targetPath: string, config: WatcherConfig = {}) {
        super();
        this.targetPath = path.resolve(targetPath);
        
        this.config = {
            recursive: true,
            debounceMs: 250,
            batchWindowMs: 150,
            includePatterns: ['**/*'],
            ignoreDirectories: ['.git', '__pycache__', 'node_modules', '.venv', 'dist', '.data'],
            allowPollingFallback: true,
            ...config
        };
    }

    public start(): void {
        if (this.watcher) return;

        log.debug(`Starting FileWatcher on: ${this.targetPath}`);

        const watchPaths = this.config.includePatterns.map(pattern => 
            path.join(this.targetPath, pattern)
        );

        this.watcher = chokidar.watch(watchPaths, {
            ignored: (testPath: string) => {
                const normalized = testPath.replace(/\\/g, '/');
                return this.config.ignoreDirectories.some(dir => normalized.includes(`/${dir}/`));
            },
            persistent: true,
            depth: this.config.recursive ? undefined : 0,
            usePolling: this.config.allowPollingFallback,
            interval: 750,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            }
        });

        this.watcher
            .on('add', (p) => this.handleEvent('created', p, false))
            .on('addDir', (p) => this.handleEvent('created', p, true))
            .on('change', (p) => this.handleEvent('modified', p, false))
            .on('unlink', (p) => this.handleEvent('deleted', p, false))
            .on('unlinkDir', (p) => this.handleEvent('deleted', p, true))
            .on('error', (error: unknown) => {
                const err = error instanceof Error ? error : new Error(String(error));
                
                log.error(`Chokidar OS Error: ${err.message}`);
                this.emit('error', error);
            });
    }

    public async stop(): Promise<void> {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
            log.debug(`FileWatcher stopped: ${this.targetPath}`);
        }
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.flushBatch();
    }

    private handleEvent(type: EventType, eventPath: string, isDirectory: boolean): void {
        const now = Date.now();
        const resolvedPath = path.resolve(eventPath);
        const debounceKey = `${type}:${resolvedPath}`;
        
        const lastSeen = this.debounceMap.get(debounceKey);

        if (lastSeen && (now - lastSeen) < this.config.debounceMs) {
            return;
        }

        this.debounceMap.set(debounceKey, now);
        setTimeout(() => this.debounceMap.delete(debounceKey), this.config.debounceMs).unref();

        this.batch.push({
            type,
            path: resolvedPath,
            isDirectory,
            timestamp: now
        });

        if (this.flushTimer) clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flushBatch(), this.config.batchWindowMs);
    }

    private flushBatch(): void {
        if (this.batch.length === 0) return;

        const processedBatch = this.detectMoves(this.batch);
        
        this.batch = [];
        
        try {
            this.emit('events', processedBatch);
        } catch (error) {
            log.error(`Failed to emit watcher events: ${(error as Error).message}`);
        }
    }

    private detectMoves(events: WatchEvent[]): WatchEvent[] {
        const deleted = events.filter(e => e.type === 'deleted');
        const created = events.filter(e => e.type === 'created');
        const others = events.filter(e => e.type !== 'deleted' && e.type !== 'created');

        const finalEvents: WatchEvent[] = [...others];
        const handledCreates = new Set<string>();

        for (const del of deleted) {
            const fileName = path.basename(del.path);
            
            const matchedCreate = created.find(c => 
                path.basename(c.path) === fileName && !handledCreates.has(c.path)
            );

            if (matchedCreate) {
                handledCreates.add(matchedCreate.path);
                finalEvents.push({
                    type: 'moved',
                    path: matchedCreate.path,
                    oldPath: del.path,
                    isDirectory: del.isDirectory,
                    timestamp: matchedCreate.timestamp
                });
            } else {
                finalEvents.push(del);
            }
        }

        for (const cre of created) {
            if (!handledCreates.has(cre.path)) {
                finalEvents.push(cre);
            }
        }

        return finalEvents;
    }
}