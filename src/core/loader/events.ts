import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getLogger } from '#core/utils/logger.js';
import { type IHeart } from '#core/heart/index.js';
import { BaseEvent } from '#core/bases/Event.js';
import { interactionRegistry } from '#core/manager/interaction/registry.js';

const log = getLogger('EventLoader');

export class EventLoader {
    private static async getFiles(dir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') log.warn(`Failed to read directory ${dir}: ${err.message}`);
            return [];
        });
        
        const paths = await Promise.all(entries.map(async (entry) => {
            const fullPath = path.resolve(dir, entry.name);
            if (entry.isDirectory()) {
                return this.getFiles(fullPath);
            }
            return fullPath.match(/\.(js)$/) ? fullPath : [];
        }));

        return paths.flat();
    }

    public static async loadForPlugin(pluginDir: string, pluginId: string, heart: IHeart): Promise<void> {
        const eventsDir = path.join(pluginDir, 'src', 'events');
        const files = await this.getFiles(eventsDir);

        if (files.length === 0) return;

        let loadedCount = 0;

        const loadPromises = files.map(async (file) => {
            try {
                const baseUrl = pathToFileURL(file).href;
                const importUrl = `${baseUrl}?v=${Date.now()}`;
                
                const Module = await import(importUrl);
                const EventClass = Module.default;
                
                if (typeof EventClass !== 'function' || !(EventClass.prototype instanceof BaseEvent)) {
                    log.warn(`[${pluginId}] File ${path.basename(file)} does not export a BaseEvent class as default. Skipping.`);
                    return;
                }

                const instance: BaseEvent = new EventClass(heart);
                if (instance.buttons) {
                    for (const [pattern, handler] of instance.buttons.entries()) {
                        interactionRegistry.button.register(pattern, handler as any, pluginId, {
                            access: {
                                permissionLevel: instance.permissionLevel,
                                roleIds: instance.roleIds,
                                userIds: instance.userIds,
                                userPermissions: instance.userPermissions,
                                clientPermissions: instance.clientPermissions,
                                allowInDm: instance.allowInDm,
                                denyMessage: instance.denyMessage
                            }
                        });
                    }
                }
                if (instance.modals) {
                    for (const [pattern, handler] of instance.modals.entries()) {
                        interactionRegistry.modal.register(pattern, handler as any, pluginId, {
                            access: {
                                permissionLevel: instance.permissionLevel,
                                roleIds: instance.roleIds,
                                userIds: instance.userIds,
                                userPermissions: instance.userPermissions,
                                clientPermissions: instance.clientPermissions,
                                allowInDm: instance.allowInDm,
                                denyMessage: instance.denyMessage
                            }
                        });
                    }
                }
                if (instance.selects) {
                    for (const [pattern, handler] of instance.selects.entries()) {
                        interactionRegistry.select.register(pattern, handler as any, pluginId, {
                            access: {
                                permissionLevel: instance.permissionLevel,
                                roleIds: instance.roleIds,
                                userIds: instance.userIds,
                                userPermissions: instance.userPermissions,
                                clientPermissions: instance.clientPermissions,
                                allowInDm: instance.allowInDm,
                                denyMessage: instance.denyMessage
                            }
                        });
                    }
                }
                if (instance.name) {
                    if (instance.once) {
                        heart.system.events.once(instance.name, (...args: any[]) => instance.execute(...args));
                    } else {
                        heart.system.events.on(instance.name, (...args: any[]) => instance.execute(...args));
                    }
                }

                loadedCount++;
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[${pluginId}] Failed to load event ${path.basename(file)}: ${err.message}`);
            }
        });

        await Promise.all(loadPromises);

        if (loadedCount > 0) log.info(`[${pluginId}] Autoloaded ${loadedCount} events.`);
    }
}