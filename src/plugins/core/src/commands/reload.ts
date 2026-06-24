// plugins/core/src/commands/reload.ts
import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';

export default class ReloadCommand extends BaseCommand {

    public readonly data = new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Enterprise core subsystem hot-reload utility.')
        .addSubcommand(sub =>
            sub.setName('config')
               .setDescription('Reload a specific configuration file.')
               .addStringOption(opt =>
                   opt.setName('file')
                      .setDescription('The configuration filename (without extension) or "all"')
                      .setAutocomplete(true)
                      .setRequired(false)
               )
        )
        .addSubcommand(sub =>
            sub.setName('lang')
               .setDescription('Reload a specific language namespace.')
               .addStringOption(opt =>
                   opt.setName('namespace')
                      .setDescription('The translation namespace or "all"')
                      .setAutocomplete(true)
                      .setRequired(false)
               )
        )
        .addSubcommand(sub =>
            sub.setName('emoji')
               .setDescription('Force reload the global emoji mappings.')
        )
        .addSubcommand(sub =>
            sub.setName('plugin')
               .setDescription('Hot-reload a specific plugin instance.')
               .addStringOption(opt =>
                   opt.setName('id')
                      .setDescription('The target plugin ID')
                      .setAutocomplete(true)
                      .setRequired(true)
               )
        );

    public readonly config: CommandConfig = {
        permissionLevel: 'owner',
        autoDefer: false,
        allowInDm: true
    };

    /**
     * Formats an array of strings into an elegant, multi-column markdown grid.
     */
    private formatGrid(items: string[], columns: number = 3): string {
        if (!items || items.length === 0) return '> *None*';
        
        const rows: string[] = [];
        for (let i = 0; i < items.length; i += columns) {
            const chunk = items.slice(i, i + columns);
            rows.push('> ' + chunk.map(item => `\`${item}\``).join(' • '));
        }
        return rows.join('\n');
    }

    /**
     * Counts module files within a specific plugin directory.
     */
    private async getModuleCount(pluginId: string, folder: string): Promise<number> {
        try {
            const dir = path.join(process.cwd(), 'plugins', pluginId, 'src', folder);
            const files = await fs.readdir(dir, { withFileTypes: true });
            return files.filter(f => f.isFile() && (f.name.endsWith('.js') || f.name.endsWith('.ts'))).length;
        } catch {
            return 0; // Folder doesn't exist or isn't readable
        }
    }

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand(true);

        try {
            switch (subcommand) {
                case 'config': {
                    const file = interaction.options.getString('file');
                    const manager = (this.heart.assets.config as any);
                    
                    const success = (!file || file === 'all') 
                        ? await manager.reloadAll() 
                        : await manager.reloadFile(file);

                    const loaded = manager.getLoadedConfigs();
                    const grid = this.formatGrid(loaded, 3);
                    
                    const details = success 
                        ? `Successfully synchronized **${loaded.length}** configuration files.\n\n${grid}`
                        : `Failed to reload target: \`${file ?? 'all'}\`. Check console for JSON parse errors.`;

                    return this.replyContainer(interaction, success, 'Configuration', details);
                }

                case 'lang': {
                    const namespace = interaction.options.getString('namespace');
                    const manager = (this.heart.assets.lang as any);
                    
                    const success = (!namespace || namespace === 'all') 
                        ? await manager.reloadAll() 
                        : await manager.reloadFile(namespace);

                    const loaded = manager.getLoadedNamespaces();
                    const grid = this.formatGrid(loaded, 3);

                    const details = success 
                        ? `Successfully recompiled translations for **${loaded.length}** namespaces.\n\n${grid}`
                        : `Failed to compile language namespace: \`${namespace ?? 'all'}\`.`;

                    return this.replyContainer(interaction, success, 'Language Cache', details);
                }

                case 'emoji': {
                    const manager = (this.heart.assets as any).emojis 
                        ?? ((await import('#core/loader/emoji.js').catch(() => null)) as any)?.emojis 
                        ?? ((await import('#core/helpers/emojiSync.js').catch(() => null)) as any)?.emojis;

                    if (!manager) throw new Error('EmojiManager is not accessible.');

                    const success = await manager.reload();
                    
                    const count = Object.keys(manager.getAll() || {}).length;
                    const details = success 
                        ? `Global emoji map refreshed and successfully mapped to **${count}** assets in memory.`
                        : `Failed to read emoji data source.`;

                    return this.replyContainer(interaction, success, 'Emoji Registry', details);
                }

                case 'plugin': {
                    const pluginId = interaction.options.getString('id', true);
                    
                    const manager = (this.heart.system as any).plugins 
                        ?? ((await import('#core/loader/index.js').catch(() => null)) as any)?.pluginManager;

                    if (!manager) throw new Error('PluginManager is not accessible.');
                    
                    const results = await manager.reload(pluginId, interaction.client);
                    const success = results.success.includes(pluginId);
                    
                    let details = success ? `Plugin \`${pluginId}\` online.` : `Surgical reload failed for \`${pluginId}\`.`;
                    
                    if (success) {
                        const plugin = manager.registry.get(pluginId);
                        if (plugin) {
                            const [cmdCount, eventCount, routeCount] = await Promise.all([
                                this.getModuleCount(pluginId, 'commands'),
                                this.getModuleCount(pluginId, 'events'),
                                this.getModuleCount(pluginId, 'routes')
                            ]);

                            details = `Successfully executed hot-reload sequence.\n\n` +
                                      `**Manifest Identity:**\n` +
                                      `> **Name:** ${plugin.manifest.name}\n` +
                                      `> **Version:** v${plugin.manifest.version}\n` +
                                      `> **State:** Live\n\n` +
                                      `**Active Modules:**\n` +
                                      `> %%emoji_gear%% **Commands:** ${cmdCount}\n` +
                                      `> %%emoji_megaphone%% **Events:** ${eventCount}\n` +
                                      `> %%emoji_globe%% **Routes:** ${routeCount}`;
                        }
                    }

                    return this.replyContainer(interaction, success, 'Plugin Ecosystem', details);
                }
            }
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Reload Command Exception: ${err.message}`);
            await this.replyContainer(interaction, false, 'System Execution', `A fatal error occurred:\n\`\`\`\n${err.message}\n\`\`\``);
        }
    }

    /**
     * Pulls the CV2 layout directly from the language config and safely builds it.
     */
    private async replyContainer(interaction: ChatInputCommandInteraction, success: boolean, title: string, details: string): Promise<void> {
        // 1. Fetch the raw JSON layout string from lang manager (compiling {{title}})
        const layoutKey = success ? 'layouts.containerSuccess' : 'layouts.containerError';
        const rawJson = this.t(layoutKey, { title });
        
        // 2. Parse into AST
        const layout: Cv2LayoutSpec = JSON.parse(rawJson);
        
        // 3. Safely inject multiline details to avoid JSON parse errors
        const container = layout.components[0] as any;
        container.children[2].content = details;

        // 4. Build and Dispatch
        const payload = buildComponentsV2(layout);
        await interaction.editReply(payload);
    }

    public async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand(true);
        const focused = interaction.options.getFocused().toLowerCase();
        let choices: string[] = [];

        try {
            if (subcommand === 'config') {
                const configDir = path.join(process.cwd(), 'configuration');
                const files = await fs.readdir(configDir).catch(() => []);
                choices = files
                    .filter(f => f.endsWith('.json5'))
                    .map(f => f.replace('.json5', ''));
                choices.unshift('all');
            } 
            else if (subcommand === 'lang') {
                const langDir = path.join(process.cwd(), 'configuration', 'lang');
                const files = await fs.readdir(langDir).catch(() => []);
                const namespaces = new Set(files.map(f => f.split('_')[0]));
                choices = Array.from(namespaces);
                choices.unshift('all');
            } 
            else if (subcommand === 'plugin') {
                const pluginsDir = path.join(process.cwd(), 'plugins');
                const entries = await fs.readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
                choices = entries
                    .filter(e => e.isDirectory())
                    .map(e => e.name);
            }
        } catch (err) {
            this.log.debug(`Autocomplete evaluation failed: ${err}`);
        }

        const filtered = choices
            .filter(c => c.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(c => ({ name: c, value: c }));

        await interaction.respond(filtered);
    }
}