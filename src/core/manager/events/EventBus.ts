import { getLogger } from '#core/utils/logger.js';

const log = getLogger('EventBus');

export type EventCallback = (...args: any[]) => any | Promise<any>;

export interface ListenerOptions {
    priority?: number;
    once?: boolean;
}

interface Listener {
    id: number;
    priority: number;
    order: number;
    callback: EventCallback;
    once: boolean;
    owner?: string;
    registeredAt: number;
}

export interface EventResult {
    event: string;
    listenerCount: number;
    results: any[];
}

export class EventBus {
    private readonly exactListeners = new Map<string, Listener[]>();
    private readonly wildcardListeners = new Map<string, Listener[]>();
    
    private readonly patternCache = new Map<string, RegExp>();
    private counter = 0;

    private getMatcher(pattern: string): RegExp {
        if (this.patternCache.size > 1000) {
            log.warn('EventBus pattern cache exceeded limit. Purging to prevent OOM crash.');
            this.patternCache.clear();
        }

        if (!this.patternCache.has(pattern)) {
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            const regexStr = '^' + escaped.replace(/\\\*/g, '.*') + '$';
            this.patternCache.set(pattern, new RegExp(regexStr));
        }
        return this.patternCache.get(pattern)!;
    }

    public on(pattern: string, callback: EventCallback, options: ListenerOptions & { owner?: string } = {}): () => void {
        const owner = options.owner;
        if (!pattern || typeof pattern !== 'string') {
            throw new TypeError("Pattern must be a non-empty string");
        }
        if (typeof callback !== 'function') {
            throw new TypeError("Callback must be a function");
        }

        const priority = options.priority ?? 0;
        const once = options.once ?? false;
        const order = this.counter++;

        const listener: Listener = { id: order, priority, order, callback, once, owner, registeredAt: Date.now() };
        
        const isWildcard = pattern.includes('*');
        const targetMap = isWildcard ? this.wildcardListeners : this.exactListeners;

        if (!targetMap.has(pattern)) {
            targetMap.set(pattern, []);
        }

        const bucket = targetMap.get(pattern)!;
        bucket.push(listener);

        bucket.sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.order - b.order;
        });

        return () => this.removeListener(pattern, callback);
    }

    public unregisterByOwner(ownerId: string): void {
        const filter = (l: Listener) => l.owner !== ownerId;

        for (const [pattern, bucket] of this.exactListeners.entries()) {
            const newBucket = bucket.filter(filter);
            if (newBucket.length === 0) this.exactListeners.delete(pattern);
            else this.exactListeners.set(pattern, newBucket);
        }

        for (const [pattern, bucket] of this.wildcardListeners.entries()) {
            const newBucket = bucket.filter(filter);
            if (newBucket.length === 0) this.wildcardListeners.delete(pattern);
            else this.wildcardListeners.set(pattern, newBucket);
        }
        
        log.debug(`[EventBus] Purged all listeners owned by: ${ownerId}`);
    }

    public once(pattern: string, callback: EventCallback, priority: number = 0): () => void {
        return this.on(pattern, callback, { priority, once: true });
    }

    public removeListener(pattern: string, callback: EventCallback): boolean {
        const isWildcard = pattern.includes('*');
        const targetMap = isWildcard ? this.wildcardListeners : this.exactListeners;
        
        const bucket = targetMap.get(pattern);
        if (!bucket) return false;

        const initialLength = bucket.length;
        const newBucket = bucket.filter(l => l.callback !== callback);

        if (newBucket.length === 0) {
            targetMap.delete(pattern);
        } else {
            targetMap.set(pattern, newBucket);
        }

        return initialLength !== newBucket.length;
    }

    public clear(): void {
        this.exactListeners.clear();
        this.wildcardListeners.clear();
        this.patternCache.clear();
        log.info('EventBus registries cleared.');
    }

    private snapshot(event: string): { pattern: string; listener: Listener }[] {
        const out: { pattern: string; listener: Listener }[] = [];

        const exactMatch = this.exactListeners.get(event);
        if (exactMatch) {
            for (const listener of exactMatch) {
                out.push({ pattern: event, listener });
            }
        }

        for (const [pattern, bucket] of this.wildcardListeners.entries()) {
            if (this.getMatcher(pattern).test(event)) {
                for (const listener of bucket) {
                    out.push({ pattern, listener });
                }
            }
        }

        out.sort((a, b) => {
            if (a.listener.priority !== b.listener.priority) return b.listener.priority - a.listener.priority;
            return a.listener.order - b.listener.order;
        });

        return out;
    }

    public async emit(event: string, ...args: any[]): Promise<EventResult> {
        const listeners = this.snapshot(event);
        const results: any[] = [];
        const toRemove: { pattern: string; callback: EventCallback }[] = [];

        for (const { pattern, listener } of listeners) {
            try {
                const result = await listener.callback(...args);
                results.push(result);
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[EventBus] Serial execution error on [${event}] via [${pattern}]: ${err.message}`, { stack: err.stack });
                results.push(err); 
            }

            if (listener.once) {
                toRemove.push({ pattern, callback: listener.callback });
            }
        }

        for (const { pattern, callback } of toRemove) this.removeListener(pattern, callback);

        return { event, listenerCount: listeners.length, results };
    }

    public async emitConcurrent(event: string, ...args: any[]): Promise<EventResult> {
        const listeners = this.snapshot(event);
        const toRemove: { pattern: string; callback: EventCallback }[] = [];

        const settledResults = await Promise.allSettled(
            listeners.map(async ({ pattern, listener }) => {
                if (listener.once) toRemove.push({ pattern, callback: listener.callback });
                
                try {
                    return await listener.callback(...args);
                } catch (error: unknown) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    log.error(`[EventBus] Concurrent execution error on [${event}] via [${pattern}]: ${err.message}`, { stack: err.stack });
                    throw err;
                }
            })
        );

        for (const { pattern, callback } of toRemove) this.removeListener(pattern, callback);

        const results = settledResults.map(r => r.status === 'fulfilled' ? r.value : r.reason);

        return { event, listenerCount: listeners.length, results };
    }
}

export const eventBus = new EventBus();