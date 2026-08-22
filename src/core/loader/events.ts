import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getLogger } from '#core/utils/logger.js';
import { type IHeart } from '#core/heart/index.js';
import { BaseEvent } from '#core/bases/Event.js';
import { interactionRegistry } from '#core/manager/interaction/registry.js';
import { guildGate, extractGuildIdFromEventArgs } from '#core/manager/guildGate.js';
import type { RouteAccessConfig } from '#core/manager/permissions.js';
import type {
    ButtonInteraction,
    ModalSubmitInteraction,
    AnySelectMenuInteraction,
} from 'discord.js';

const log = getLogger('EventLoader');

type EventConstructor = new (heart: IHeart) => BaseEvent;

function accessFromEvent(instance: BaseEvent): RouteAccessConfig {
    return {
        permissionLevel: instance.permissionLevel,
        roleIds: instance.roleIds,
        userIds: instance.userIds,
        userPermissions: instance.userPermissions,
        clientPermissions: instance.clientPermissions,
        allowInDm: instance.allowInDm,
        denyMessage: instance.denyMessage,
    };
}

export class EventLoader {
    private static async getFiles(dir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') log.warn(`Failed to read directory ${dir}: ${err.message}`);
            return [] as import('node:fs').Dirent[];
        });

        const paths = await Promise.all(
            entries.map(async (entry) => {
                const fullPath = path.resolve(dir, entry.name);
                if (entry.isDirectory()) {
                    return this.getFiles(fullPath);
                }
                return fullPath.match(/\.(js)$/) ? fullPath : [];
            }),
        );

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

                const Module = (await import(importUrl)) as { default?: EventConstructor };
                const EventClass = Module.default;

                if (typeof EventClass !== 'function' || !(EventClass.prototype instanceof BaseEvent)) {
                    log.warn(
                        `[${pluginId}] File ${path.basename(file)} does not export a BaseEvent class as default. Skipping.`,
                    );
                    return;
                }

                const instance: BaseEvent = new EventClass(heart);
                const access = accessFromEvent(instance);

                if (instance.buttons) {
                    for (const [pattern, handler] of instance.buttons.entries()) {
                        if (pattern instanceof RegExp) {
                            interactionRegistry.button.register(
                                pattern,
                                async (interaction: ButtonInteraction, match: RegExpMatchArray) => {
                                    await handler(interaction, match);
                                },
                                pluginId,
                                { access },
                            );
                        } else {
                            interactionRegistry.button.register(
                                pattern,
                                async (interaction: ButtonInteraction) => {
                                    await handler(interaction);
                                },
                                pluginId,
                                { access },
                            );
                        }
                    }
                }
                if (instance.modals) {
                    for (const [pattern, handler] of instance.modals.entries()) {
                        if (pattern instanceof RegExp) {
                            interactionRegistry.modal.register(
                                pattern,
                                async (interaction: ModalSubmitInteraction, match: RegExpMatchArray) => {
                                    await handler(interaction, match);
                                },
                                pluginId,
                                { access },
                            );
                        } else {
                            interactionRegistry.modal.register(
                                pattern,
                                async (interaction: ModalSubmitInteraction) => {
                                    await handler(interaction);
                                },
                                pluginId,
                                { access },
                            );
                        }
                    }
                }
                if (instance.selects) {
                    for (const [pattern, handler] of instance.selects.entries()) {
                        if (pattern instanceof RegExp) {
                            interactionRegistry.select.register(
                                pattern,
                                async (interaction: AnySelectMenuInteraction, match: RegExpMatchArray) => {
                                    await handler(interaction, match);
                                },
                                pluginId,
                                { access },
                            );
                        } else {
                            interactionRegistry.select.register(
                                pattern,
                                async (interaction: AnySelectMenuInteraction) => {
                                    await handler(interaction);
                                },
                                pluginId,
                                { access },
                            );
                        }
                    }
                }
                if (instance.name) {
                    const run = (...args: unknown[]) => {
                        const gid = extractGuildIdFromEventArgs(args);
                        if (guildGate.isReady() && guildGate.isPluginBlocked(pluginId, gid)) {
                            return;
                        }
                        return instance.execute(...args);
                    };
                    if (instance.once) {
                        heart.system.events.once(instance.name, (...args: unknown[]) => instance.execute(...args));
                    } else {
                        heart.system.events.on(instance.name, run);
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
