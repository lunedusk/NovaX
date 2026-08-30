import { cacheFacade, type CacheFacade, type CacheNamespace } from '#core/manager/cacheFacade.js';

export type CacheDomain = {
    readonly facade: CacheFacade;
    readonly ns: (alias?: string) => CacheNamespace;
};

export const cacheDomain: CacheDomain = Object.freeze({
    facade: cacheFacade,
    ns: (alias?: string) => cacheFacade.namespace(alias),
});
