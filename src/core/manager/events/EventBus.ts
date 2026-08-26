import type { Client, Interaction } from 'discord.js';
import type { AuditRecord } from '#core/audit/types.js';
import type { ErrorOccurrence } from '#core/errors/types.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('EventBus');

export type EventArgsMap = {
    'discord.clientReady': [client: Client<true>];
    'discord.error': [error: Error];
    'discord.interactionCreate': [interaction: Interaction];
    'discord.guildCreate': unknown[];
    'discord.guildDelete': unknown[];
    'system.ready': [client: Client<true>];
    'command:executed': [payload: { pluginId: string; commandName: string }];
    'audit.recorded': [entry: AuditRecord];
    'error.recorded': [entry: ErrorOccurrence];
};

export type ArgsFor<E extends string> = string extends E
    ? unknown[]
    : E extends keyof EventArgsMap
      ? EventArgsMap[E]
      : unknown[];

export type EventCallback<E extends string = string> = (
    ...args: ArgsFor<E>
) => unknown | Promise<unknown>;

type StoredCallback = (...args: unknown[]) => unknown | Promise<unknown>;

export interface ListenerOptions {
    priority?: number;
    once?: boolean;
}

interface Listener {
    id: number;
    priority: number;
    order: number;
    callback: StoredCallback;
    once: boolean;
    owner?: string;
    registeredAt: number;
}

export interface EventResult {
    event: string;
    listenerCount: number;
    results: unknown[];
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

        let matcher = this.patternCache.get(pattern);
        if (!matcher) {
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            const regexStr = '^' + escaped.replace(/\\\*/g, '.*') + '$';
            matcher = new RegExp(regexStr);
            this.patternCache.set(pattern, matcher);
        }
        return matcher;
    }

    public on<E extends string>(
        pattern: E,
        callback: EventCallback<E>,
        options: ListenerOptions & { owner?: string } = {},
    ): () => void {
        const owner = options.owner;
        if (!pattern || typeof pattern !== 'string') {
            throw new TypeError('Pattern must be a non-empty string');
        }
        if (typeof callback !== 'function') {
            throw new TypeError('Callback must be a function');
        }

        const priority = options.priority ?? 0;
        const once = options.once ?? false;
        const order = this.counter++;

        const listener: Listener = {
            id: order,
            priority,
            order,
            callback: callback as StoredCallback,
            once,
            owner,
            registeredAt: Date.now(),
        };

        const isWildcard = pattern.includes('*');
        const targetMap = isWildcard ? this.wildcardListeners : this.exactListeners;

        if (!targetMap.has(pattern)) {
            targetMap.set(pattern, []);
        }

        const bucket = targetMap.get(pattern);
        if (!bucket) {
            throw new Error(`EventBus: failed to create listener bucket for ${pattern}`);
        }
        bucket.push(listener);

        bucket.sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.order - b.order;
        });

        return () => {
            this.removeListener(pattern, callback as StoredCallback);
        };
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

    public once<E extends string>(
        pattern: E,
        callback: EventCallback<E>,
        priority: number = 0,
    ): () => void {
        return this.on(pattern, callback, { priority, once: true });
    }

    public removeListener(pattern: string, callback: StoredCallback): boolean {
        const isWildcard = pattern.includes('*');
        const targetMap = isWildcard ? this.wildcardListeners : this.exactListeners;

        const bucket = targetMap.get(pattern);
        if (!bucket) return false;

        const initialLength = bucket.length;
        const newBucket = bucket.filter((l) => l.callback !== callback);

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

    public async emit(event: string, ...args: unknown[]): Promise<EventResult> {
        const listeners = this.snapshot(event);
        const results: unknown[] = [];
        const toRemove: { pattern: string; callback: StoredCallback }[] = [];

        for (const { pattern, listener } of listeners) {
            try {
                const result = await listener.callback(...args);
                results.push(result);
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[EventBus] Serial execution error on [${event}] via [${pattern}]: ${err.message}`, {
                    stack: err.stack,
                });
                results.push(err);
            }

            if (listener.once) {
                toRemove.push({ pattern, callback: listener.callback });
            }
        }

        for (const { pattern, callback } of toRemove) this.removeListener(pattern, callback);

        return { event, listenerCount: listeners.length, results };
    }

    public async emitConcurrent(event: string, ...args: unknown[]): Promise<EventResult> {
        const listeners = this.snapshot(event);
        const toRemove: { pattern: string; callback: StoredCallback }[] = [];

        const settledResults = await Promise.allSettled(
            listeners.map(async ({ pattern, listener }) => {
                if (listener.once) toRemove.push({ pattern, callback: listener.callback });

                try {
                    return await listener.callback(...args);
                } catch (error: unknown) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    log.error(`[EventBus] Concurrent execution error on [${event}] via [${pattern}]: ${err.message}`, {
                        stack: err.stack,
                    });
                    throw err;
                }
            }),
        );

        for (const { pattern, callback } of toRemove) this.removeListener(pattern, callback);

        const results = settledResults.map((r) => (r.status === 'fulfilled' ? r.value : r.reason));

        return { event, listenerCount: listeners.length, results };
    }

    public listInspect(): Array<{
        name: string;
        once: boolean;
        priority: number;
        pluginId: string | null;
    }> {
        const out: Array<{
            name: string;
            once: boolean;
            priority: number;
            pluginId: string | null;
        }> = [];
        for (const [pattern, bucket] of this.exactListeners.entries()) {
            for (const listener of bucket) {
                out.push({
                    name: pattern,
                    once: listener.once,
                    priority: listener.priority,
                    pluginId: listener.owner ?? null,
                });
            }
        }
        for (const [pattern, bucket] of this.wildcardListeners.entries()) {
            for (const listener of bucket) {
                out.push({
                    name: pattern,
                    once: listener.once,
                    priority: listener.priority,
                    pluginId: listener.owner ?? null,
                });
            }
        }
        out.sort((a, b) => a.name.localeCompare(b.name) || (b.priority - a.priority));
        return out;
    }
}

export const eventBus = new EventBus();
