import { eventBus } from '#core/manager/events/EventBus.js';
import { scheduler } from '#core/scheduler/index.js';
import { CooldownManager } from '#core/manager/cooldown.js';
import { handlerRegistry } from '#core/manager/handler/registry.js';
import { type BaseHandler } from '#core/bases/Handler.js';
export interface HandlerRegistryAccessor {
    [pluginId: string]:
        | Readonly<Record<string, BaseHandler>>
        | undefined
        | ((...args: never[]) => unknown);

    $has(pluginId: string, name?: string): boolean;
    $get<T extends BaseHandler = BaseHandler>(pluginId: string, name: string): T | undefined;
    $list(): Array<{ pluginId: string; name: string }>;
    $listDetailed(): Array<{ pluginId: string; name: string; version?: string; description?: string }>;
}

const handlerAccessor = new Proxy({} as HandlerRegistryAccessor, {
    get(_target, prop: string) {
        if (prop === '$has')          return (pid: string, name?: string) => handlerRegistry.has(pid, name);
        if (prop === '$get')          return <T extends BaseHandler>(pid: string, name: string) => handlerRegistry.get<T>(pid, name);
        if (prop === '$list')         return () => handlerRegistry.list();
        if (prop === '$listDetailed') return () => handlerRegistry.listDetailed();
        return handlerRegistry.getPluginAccessor(prop);
    },
    has(_target, prop: string) {
        return handlerRegistry.has(prop as string);
    },
    ownKeys() {
        return handlerRegistry.pluginIds;
    },
    getOwnPropertyDescriptor(_target, prop: string) {
        if (handlerRegistry.has(prop as string)) {
            return { configurable: true, enumerable: true, value: undefined };
        }
        return undefined;
    },
});

export type SystemDomain = {
    readonly events: typeof eventBus;
    readonly scheduler: typeof scheduler;
    readonly cooldowns: typeof CooldownManager;
    readonly handler: HandlerRegistryAccessor;
};

export const systemDomain: SystemDomain = Object.freeze({
    events: eventBus,
    scheduler: scheduler,
    cooldowns: CooldownManager,
    handler: handlerAccessor,
});