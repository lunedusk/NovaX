import { getLogger } from '#core/utils/logger.js';
import { BaseHandler } from '#core/bases/Handler.js';

const log = getLogger('HandlerRegistry');

const TEARDOWN_TIMEOUT_MS = 15_000;
const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function withTeardownTimeout(promise: Promise<void>, pluginId: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(
                `onTeardown() timed out after ${TEARDOWN_TIMEOUT_MS}ms for handler "${pluginId}.${name}"`
            ));
        }, TEARDOWN_TIMEOUT_MS);

        promise.then(
            () => { clearTimeout(timer); resolve(); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

class HandlerRegistry {
    private readonly store = new Map<string, Map<string, BaseHandler>>();
    private readonly proxyCache = new Map<string, Readonly<Record<string, BaseHandler>>>();

    private invalidateCache(pluginId: string): void {
        this.proxyCache.delete(pluginId);
    }

    public getPluginAccessor(pluginId: string): Readonly<Record<string, BaseHandler>> | undefined {
        const cached = this.proxyCache.get(pluginId);
        if (cached) return cached;

        const pluginHandlers = this.store.get(pluginId);
        if (!pluginHandlers || pluginHandlers.size === 0) return undefined;

        const accessor: Record<string, BaseHandler> = {};
        for (const [name, instance] of pluginHandlers) {
            accessor[name] = instance;
        }

        const frozen = Object.freeze(accessor);
        this.proxyCache.set(pluginId, frozen);
        return frozen;
    }

    public register(pluginId: string, name: string, instance: BaseHandler): void {
        if (!VALID_IDENTIFIER.test(name)) {
            throw new Error(
                `[${pluginId}] Handler name "${name}" is not a valid JavaScript identifier. ` +
                `Names must match /^[a-zA-Z_$][a-zA-Z0-9_$]*$/ (camelCase recommended).`
            );
        }

        if (!this.store.has(pluginId)) {
            this.store.set(pluginId, new Map());
        }

        const pluginHandlers = this.store.get(pluginId)!;

        if (pluginHandlers.has(name)) {
            log.debug(`[${pluginId}] Re-registering handler "${name}" (same-plugin overwrite).`);
        }

        pluginHandlers.set(name, instance);
        this.invalidateCache(pluginId);
        log.debug(`[${pluginId}] Registered handler "${name}".`);
    }

    public unregister(pluginId: string, name: string): void {
        const pluginHandlers = this.store.get(pluginId);
        if (!pluginHandlers?.has(name)) return;

        pluginHandlers.delete(name);
        if (pluginHandlers.size === 0) this.store.delete(pluginId);
        this.invalidateCache(pluginId);
        log.debug(`[${pluginId}] Unregistered handler "${name}".`);
    }

    public async unregisterPlugin(pluginId: string): Promise<void> {
        const pluginHandlers = this.store.get(pluginId);
        if (!pluginHandlers || pluginHandlers.size === 0) return;

        const entries = Array.from(pluginHandlers.entries());

        await Promise.all(
            entries.map(async ([name, instance]) => {
                try {
                    await withTeardownTimeout(instance.onTeardown(), pluginId, name);
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    log.error(`[${pluginId}] onTeardown() failed for handler "${name}": ${err.message}`);
                }
                log.debug(`[${pluginId}] Torn down handler "${name}".`);
            })
        );

        this.store.delete(pluginId);
        this.invalidateCache(pluginId);
        log.debug(`[${pluginId}] All handlers unregistered.`);
    }

    public get<T extends BaseHandler = BaseHandler>(pluginId: string, name: string): T | undefined {
        return this.store.get(pluginId)?.get(name) as T | undefined;
    }

    public has(pluginId: string, name?: string): boolean {
        const pluginHandlers = this.store.get(pluginId);
        if (!pluginHandlers || pluginHandlers.size === 0) return false;
        if (name === undefined) return true;
        return pluginHandlers.has(name);
    }

    public getByPlugin(pluginId: string): Map<string, BaseHandler> | undefined {
        const pluginHandlers = this.store.get(pluginId);
        if (!pluginHandlers || pluginHandlers.size === 0) return undefined;
        return pluginHandlers;
    }

    public list(): Array<{ pluginId: string; name: string }> {
        const results: Array<{ pluginId: string; name: string }> = [];
        for (const [pluginId, pluginHandlers] of this.store) {
            for (const name of pluginHandlers.keys()) {
                results.push({ pluginId, name });
            }
        }
        return results;
    }

    public listDetailed(): Array<{ pluginId: string; name: string; version?: string; description?: string }> {
        const results: Array<{ pluginId: string; name: string; version?: string; description?: string }> = [];
        for (const [pluginId, pluginHandlers] of this.store) {
            for (const [name, instance] of pluginHandlers) {
                results.push({ pluginId, name, version: instance.version, description: instance.description });
            }
        }
        return results;
    }

    public get pluginIds(): string[] {
        return Array.from(this.store.keys());
    }

    public get size(): number {
        let total = 0;
        for (const pluginHandlers of this.store.values()) total += pluginHandlers.size;
        return total;
    }

    public clear(): void {
        this.store.clear();
        this.proxyCache.clear();
    }
}

export const handlerRegistry = new HandlerRegistry();
export type { HandlerRegistry };