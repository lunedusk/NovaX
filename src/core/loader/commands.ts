import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { 
    type ChatInputCommandInteraction, 
    type AutocompleteInteraction 
} from 'discord.js';

import { getLogger } from '#core/utils/logger.js';
import { type IHeart } from '#core/heart/index.js';
import { BaseCommand } from '#core/bases/Command.js';
import { permissionsManager } from '#core/manager/permissions.js';

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
        const isDev = process.env.NODE_ENV !== 'production';

        const loadPromises = files.map(async (file) => {
            try {
                const baseUrl = pathToFileURL(file).href;
                const importUrl = isDev ? `${baseUrl}?v=${Date.now()}` : baseUrl;
                
                const Module = await import(importUrl);
                const CommandClass = Module.default;
                
                if (typeof CommandClass !== 'function' || !(CommandClass.prototype instanceof BaseCommand)) {
                    log.warn(`[${pluginId}] ${path.basename(file)} does not export a valid BaseCommand. Skipping.`);
                    return;
                }

                const instance: BaseCommand = new CommandClass(heart);
                
                if (!instance.data || typeof instance.data.name !== 'string') {
                    throw new TypeError(`Command lacks a valid 'data.name'. Ensure SlashCommandBuilder is initialized.`);
                }

                const commandName = instance.data.name;
                permissionsManager.applyCommandDefaults(instance.data, instance.config);

                heart.discord.interactions.chat.register(
                    commandName, 
                    (i: ChatInputCommandInteraction) => instance.execute(i),
                    pluginId,
                    {
                        data: instance.data,
                        access: instance.config
                    }
                );

                if (typeof instance.autocomplete === 'function') {
                    heart.discord.interactions.autocomplete.register(
                        commandName, 
                        (i: AutocompleteInteraction) => instance.autocomplete!(i),
                        pluginId
                    );
                }

                loadedCount++;
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[${pluginId}] Failed to load command ${path.basename(file)}: ${err.message}`);
            }
        });

        await Promise.all(loadPromises);

        if (loadedCount > 0) {
            log.info(`[${pluginId}] Successfully autoloaded ${loadedCount} command(s).`);
        }
    }
}