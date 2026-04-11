import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import type { Dirent } from 'node:fs';
import { type Client } from 'discord.js';

import { getLogger } from '#core/utils/logger.js';
import { HeartFactory } from '#core/heart/index.js';
import { BasePlugin, PluginState, type PluginManifest } from '#core/bases/Plugin.js';

import { CommandLoader } from './commands.js';
import { configLoader } from './config.js';
import { DependencyLoader } from './dependency.js';
import { emojiLoader } from './emoji.js';
import { EventLoader } from './events.js';
import { langLoader } from './lang.js';
import { RouteLoader } from './routes.js';

const log = getLogger('PluginManager');

interface DiscoveredPlugin {
    dir: string;
    manifest: PluginManifest;
}

export enum PluginBootStatus {
    Pending = 'PENDING',
    Success = 'SUCCESS',
    Failed = 'FAILED',
    Skipped = 'SKIPPED'
}

export class PluginManager extends EventEmitter {
    private readonly pluginsDir: string;
    public readonly registry = new Map<string, BasePlugin>();
    
    private readonly bootStatuses = new Map<string, PluginBootStatus>();

    private readonly LIFECYCLE_TIMEOUT_MS = 15000;

    constructor(baseDir: string = process.cwd()) {
        super();
        this.pluginsDir = path.join(baseDir, 'plugins');
    }

    private async withTimeout<T>(promise: Promise<T>, pluginId: string, phase: string): Promise<T> {
        let timeoutHandle: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`[${pluginId}] ${phase} timed out after ${this.LIFECYCLE_TIMEOUT_MS}ms.`));
            }, this.LIFECYCLE_TIMEOUT_MS);
        });

        return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
    }

    private sortDependencies(plugins: Map<string, DiscoveredPlugin>): DiscoveredPlugin[] {
        const sorted: DiscoveredPlugin[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();

        const visit = (pluginId: string, requiredBy?: string) => {
            if (visiting.has(pluginId)) {
                throw new Error(`Circular dependency detected: '${pluginId}' -> '${requiredBy}'`);
            }
            if (visited.has(pluginId)) return;

            visiting.add(pluginId);

            const plugin = plugins.get(pluginId);
            if (!plugin) {
                throw new Error(`Missing required dependency: '${pluginId}' (Required by '${requiredBy}')`);
            }

            if (plugin.manifest.dependencies) {
                for (const depId of plugin.manifest.dependencies) {
                    visit(depId, pluginId);
                }
            }

            visiting.delete(pluginId);
            visited.add(pluginId);
            sorted.push(plugin);
        };

        for (const pluginId of plugins.keys()) {
            try {
                visit(pluginId);
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`Dependency resolution failed for '${pluginId}': ${err.message}`);
                plugins.delete(pluginId); 
            }
        }

        return sorted;
    }

    private async discoverPlugins(): Promise<Map<string, DiscoveredPlugin>> {
        const discovered = new Map<string, DiscoveredPlugin>();
        
        try {
            const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
            
            await Promise.all(entries.map(async (entry: Dirent) => {
                if (!entry.isDirectory()) return;

                const pluginDir = path.join(this.pluginsDir, entry.name);
                const manifestPath = path.join(pluginDir, 'manifest.json');

                try {
                    const rawManifest = await fs.readFile(manifestPath, 'utf-8');
                    const manifest: PluginManifest = JSON.parse(rawManifest);

                    if (!manifest.id || !manifest.name || !manifest.version) {
                        log.warn(`[${entry.name}] Invalid manifest.json. Skipping.`);
                        return;
                    }

                    discovered.set(manifest.id, { dir: pluginDir, manifest });
                    this.bootStatuses.set(manifest.id, PluginBootStatus.Pending);
                } catch (error: unknown) {
                    const err = error as NodeJS.ErrnoException;
                    if (err.code !== 'ENOENT') log.error(`[${entry.name}] Failed to parse manifest: ${err.message}`);
                }
            }));

        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'ENOENT') log.info('No plugins directory found. Skipping load.');
            else throw error;
        }

        return discovered;
    }

    private async bootSinglePlugin(plugin: DiscoveredPlugin, baseClient: Client<true>): Promise<void> {
        const { dir, manifest } = plugin;
        const id = manifest.id;
        const start = performance.now();

        if (manifest.dependencies) {
            for (const depId of manifest.dependencies) {
                if (this.bootStatuses.get(depId) !== PluginBootStatus.Success) {
                    this.bootStatuses.set(id, PluginBootStatus.Skipped);
                    log.warn(`[${id}] Skipped boot. Required dependency '${depId}' failed or was skipped.`);
                    return;
                }
            }
        }

        log.info(`[${id}] Booting v${manifest.version}...`);

        try {
            await DependencyLoader.installFromPackageJson(dir, id);
            await configLoader.syncPlugin(dir, id);
            await langLoader.syncPlugin(dir, id);

            const isDev = process.env.NODE_ENV !== 'production';
            const entryPath = path.join(dir, 'src', 'index.js');
            const baseUrl = pathToFileURL(entryPath).href;
            const importUrl = isDev ? `${baseUrl}?v=${Date.now()}` : baseUrl;

            const Module = await import(importUrl).catch(err => {
                throw new Error(`Failed to evaluate entrypoint: ${err.message}`);
            });

            const PluginClass = Module.default;
            if (typeof PluginClass !== 'function' || !(PluginClass.prototype instanceof BasePlugin)) {
                throw new Error(`Entrypoint does not export a valid BasePlugin class as default.`);
            }
            
            const scopedHeart = HeartFactory.create(id, baseClient);
            scopedHeart.assets.config.reloadFile(id);
            scopedHeart.assets.lang.reloadFile(id);
            const instance: BasePlugin = new PluginClass();
            instance._injectCore(scopedHeart); 
            
            instance._setState(PluginState.Setup);
            if (typeof instance.onSetup === 'function') {
                await this.withTimeout(instance.onSetup(), id, 'onSetup()');
            }
            
            await EventLoader.loadForPlugin(dir, id, scopedHeart);
            await CommandLoader.loadForPlugin(dir, id, scopedHeart);
            await RouteLoader.loadForPlugin(dir, id, scopedHeart);

            instance._setState(PluginState.Enabled);
            await this.withTimeout(instance.onEnable(), id, 'onEnable()');

            this.registry.set(id, instance);
            this.bootStatuses.set(id, PluginBootStatus.Success);
            
            const timeMs = (performance.now() - start).toFixed(2);
            log.info(`[${id}] Successfully enabled in ${timeMs}ms.`);
            this.emit('pluginLoaded', manifest);

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.bootStatuses.set(id, PluginBootStatus.Failed);
            log.error(`[${id}] Critical failure during boot sequence: ${err.message}`, { stack: err.stack });
            this.emit('pluginFailed', manifest, err);
        }
    }

    public async bootAll(baseClient: Client<true>): Promise<void> {
        const totalStart = performance.now();
        log.info('Initializing Plugin Ecosystem...');

        const discoveredMap = await this.discoverPlugins();
        if (discoveredMap.size === 0) return;

        const sortedPlugins = this.sortDependencies(discoveredMap);
        log.info(`Resolved dependency graph for ${sortedPlugins.length} plugins.`);

        for (const plugin of sortedPlugins) {
            await this.bootSinglePlugin(plugin, baseClient);
        }

        if (baseClient) {
            await emojiLoader.init(baseClient);
        } else {
            log.warn('Discord client unavailable. Skipping global Emoji sync.');
        }

        const activeCount = this.registry.size;
        const totalTime = ((performance.now() - totalStart) / 1000).toFixed(2);
        const failedCount = sortedPlugins.length - activeCount;

        log.info(`Ecosystem Boot Complete in ${totalTime}s. [Loaded: ${activeCount}] [Failed/Skipped: ${failedCount}]`);
        this.emit('ecosystemReady', { loaded: activeCount, failed: failedCount, timeSec: totalTime });
    }

    public async disable(pluginId: string): Promise<boolean> {
        const plugin = this.registry.get(pluginId);
        
        if (!plugin) {
            log.warn(`[${pluginId}] Teardown requested but plugin is not active in the registry.`);
            return false;
        }

        log.info(`[${pluginId}] Initiating surgical deconstruction...`);
        const start = performance.now();

        try {
            if (plugin.state === PluginState.Enabled) {
                await this.withTimeout(plugin.onDisable(), pluginId, 'onDisable');
                plugin._setState(PluginState.Disabled);
            }

            const heart = (plugin as any).heart; 

            if (heart?.discord?.interactions) {
                heart.discord.interactions.unregisterPlugin(pluginId);
                log.debug(`[${pluginId}] Purged Discord interactions.`);
            }

            if (heart?.system?.events) {
                heart.system.events.unregisterByOwner(pluginId);
                log.debug(`[${pluginId}] Purged EventBus subscriptions.`);
            }

            if (heart?.net?.http) {
                const apiNamespace = `/api/plugins/${pluginId}`;
                heart.net.http.unregisterRouter(apiNamespace);
                log.debug(`[${pluginId}] Unmounted API namespace: ${apiNamespace}`);
            }

            this.registry.delete(pluginId);
            this.bootStatuses.set(pluginId, PluginBootStatus.Pending);

            const duration = (performance.now() - start).toFixed(2);
            log.info(`[${pluginId}] Deconstruction complete in ${duration}ms.`);
            
            this.emit('pluginDisabled', pluginId);
            return true;

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`[${pluginId}] Fatal error during teardown: ${err.message}`);
            plugin._setState(PluginState.Error);
            return false;
        }
    }

    public async shutdownAll(): Promise<void> {
        log.info('Initiating graceful shutdown of all plugins...');
        
        const activePlugins = Array.from(this.registry.values()).reverse();

        for (const plugin of activePlugins) {
            try {
                if (plugin.isEnabled) {
                    await this.withTimeout(plugin.onDisable(), plugin.manifest.id, 'onDisable()');
                    plugin._setState(PluginState.Disabled);
                    log.info(`[${plugin.manifest.id}] Shut down successfully.`);
                }
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[${plugin.manifest.id}] Error during shutdown: ${err.message}`);
            }
        }
        
        this.registry.clear();
        this.bootStatuses.clear();
        this.emit('ecosystemOffline');
    }
}