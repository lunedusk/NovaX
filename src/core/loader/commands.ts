import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    type ChatInputCommandInteraction,
    type AutocompleteInteraction,
    type SlashCommandBuilder,
} from 'discord.js';

import { getLogger } from '#core/utils/logger.js';
import { type IHeart } from '#core/heart/index.js';
import { BaseCommand } from '#core/bases/Command.js';
import { permissionsManager } from '#core/manager/permissions.js';
import { registerRootCommand } from './commandRegistry.js';
import { runMiddlewarePipeline } from './middlewares.js';

const log = getLogger('CommandLoader');

export class CommandLoader {
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
            return fullPath.endsWith('.js') ? fullPath : [];
        }));

        return paths.flat();
    }

    public static async loadForPlugin(pluginDir: string, pluginId: string, heart: IHeart): Promise<void> {
        const commandsDir = path.join(pluginDir, 'src', 'commands');
        const files = await this.getFiles(commandsDir);

        if (files.length === 0) return;

        let loadedCount = 0;

        for (const file of files) {
            try {
                const baseUrl = pathToFileURL(file).href;
                const importUrl = `${baseUrl}?v=${Date.now()}`;

                const Module = await import(importUrl);
                const CommandClass = Module.default;

                if (typeof CommandClass !== 'function' || !(CommandClass.prototype instanceof BaseCommand)) {
                    log.warn(`[${pluginId}] ${path.basename(file)} does not export a valid BaseCommand. Skipping.`);
                    continue;
                }

                const instance: BaseCommand = new CommandClass(heart);

                if (!instance.data || typeof instance.data.name !== 'string') {
                    throw new TypeError(`Command lacks a valid 'data.name'. Ensure SlashCommandBuilder is initialized.`);
                }

                permissionsManager!.applyCommandDefaults(instance.data, instance.config);

                const ok = await registerRootCommand({
                    heart,
                    pluginId,
                    data: instance.data as SlashCommandBuilder,
                    config: instance.config,
                    execute: async (i: ChatInputCommandInteraction) => {
                        const pipe = await runMiddlewarePipeline('command', {
                            heart,
                            pluginId,
                            phase: 'command',
                            interaction: i,
                            commandInteraction: i,
                        });
                        if (pipe === 'stop') return;
                        if (typeof instance.onBeforeExecute === 'function') {
                            const cont = await instance.onBeforeExecute(i);
                            if (cont === false) return;
                        }
                        try {
                            await instance.execute(i);
                            if (typeof instance.onAfterExecute === 'function') {
                                await instance.onAfterExecute(i);
                            }
                        } catch (error: unknown) {
                            const err = error instanceof Error ? error : new Error(String(error));
                            await instance.onError(err, i);
                        }
                    },
                    autocomplete:
                        typeof instance.autocomplete === 'function'
                            ? (i: AutocompleteInteraction) => instance.autocomplete!(i)
                            : undefined,
                    requirements: instance.config.requirements,
                });

                if (ok) loadedCount++;
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[${pluginId}] Failed to load command ${path.basename(file)}: ${err.message}`);
                throw err;
            }
        }

        if (loadedCount > 0) {
            log.info(`[${pluginId}] Successfully autoloaded ${loadedCount} command(s).`);
        }
    }
}
