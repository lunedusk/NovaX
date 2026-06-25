import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';

export default class ReloadCommand extends BaseCommand {

    public readonly data = new SlashCommandBuilder()
        .setName('reload')
        .setDescription(this.t('commands.reload.description'))
        .addSubcommand(sub =>
            sub.setName('config')
               .setDescription(this.t('commands.reload.configDescription'))
               .addStringOption(opt =>
                   opt.setName('file')
                      .setDescription(this.t('commands.reload.fileDescription'))
                      .setAutocomplete(true)
                      .setRequired(false)
               )
        )
        .addSubcommand(sub =>
            sub.setName('lang')
               .setDescription(this.t('commands.reload.langDescription'))
               .addStringOption(opt =>
                   opt.setName('namespace')
                      .setDescription(this.t('commands.reload.namespaceDescription'))
                      .setAutocomplete(true)
                      .setRequired(false)
               )
        )
        .addSubcommand(sub =>
            sub.setName('emoji')
               .setDescription(this.t('commands.reload.emojiDescription'))
        )
        .addSubcommand(sub =>
            sub.setName('plugin')
               .setDescription(this.t('commands.reload.pluginDescription'))
               .addStringOption(opt =>
                   opt.setName('id')
                      .setDescription(this.t('commands.reload.idDescription'))
                      .setAutocomplete(true)
                      .setRequired(true)
               )
        );

    public readonly config: CommandConfig = {
        permissionLevel: 'owner',
        autoDefer: false,
        allowInDm: true
    };

    private formatGrid(items: string[], columns: number = 3): string {
        if (!items || items.length === 0) return '> *None*';
        const rows: string[] = [];
        for (let i = 0; i < items.length; i += columns) {
            rows.push('> ' + items.slice(i, i + columns).map(item => `\`${item}\``).join(' • '));
        }
        return rows.join('\n');
    }

    private async getModuleCount(pluginId: string, folder: string): Promise<number> {
        try {
            const dir = path.join(process.cwd(), 'plugins', pluginId, 'src', folder);
            const files = await fs.readdir(dir, { withFileTypes: true });
            return files.filter(f => f.isFile() && (f.name.endsWith('.js') || f.name.endsWith('.ts'))).length;
        } catch {
            return 0;
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
                    const details = success 
                        ? this.t('commands.reload.messages.configSuccess', { count: loaded.length, grid: this.formatGrid(loaded) })
                        : this.t('commands.reload.messages.configError', { file: file ?? 'all' });

                    return this.replyContainer(interaction, success, 'Configuration', details);
                }

                case 'lang': {
                    const namespace = interaction.options.getString('namespace');
                    const manager = (this.heart.assets.lang as any);
                    
                    const success = (!namespace || namespace === 'all') 
                        ? await manager.reloadAll() 
                        : await manager.reloadFile(namespace);

                    const loaded = manager.getLoadedNamespaces();
                    const details = success 
                        ? this.t('commands.reload.messages.langSuccess', { count: loaded.length, grid: this.formatGrid(loaded) })
                        : this.t('commands.reload.messages.langError', { namespace: namespace ?? 'all' });

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
                        ? this.t('commands.reload.messages.emojiSuccess', { count })
                        : this.t('commands.reload.messages.emojiError');

                    return this.replyContainer(interaction, success, 'Emoji Registry', details);
                }

                case 'plugin': {
                    const pluginId = interaction.options.getString('id', true);
                    const manager = (this.heart.system as any).plugins 
                        ?? ((await import('#core/loader/index.js').catch(() => null)) as any)?.pluginManager;

                    if (!manager) throw new Error('PluginManager is not accessible.');
                    
                    const results = await manager.reload(pluginId, interaction.client);
                    const success = results.success.includes(pluginId);
                    
                    let details = this.t('commands.reload.messages.pluginError', { pluginId });
                    
                    if (success) {
                        const plugin = manager.registry.get(pluginId);
                        if (plugin) {
                            const [cmdCount, eventCount, routeCount] = await Promise.all([
                                this.getModuleCount(pluginId, 'commands'),
                                this.getModuleCount(pluginId, 'events'),
                                this.getModuleCount(pluginId, 'routes')
                            ]);

                            details = this.t('commands.reload.messages.pluginSuccess', {
                                name: plugin.manifest.name,
                                version: plugin.manifest.version,
                                cmdCount, eventCount, routeCount
                            });
                        }
                    }

                    return this.replyContainer(interaction, success, 'Plugin Ecosystem', details);
                }
            }
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Reload Command Exception: ${err.message}`);
            
            const details = this.t('commands.reload.messages.fatalError', { error: err.message });
            await this.replyContainer(interaction, false, 'System Execution', details);
        }
    }

    private async replyContainer(interaction: ChatInputCommandInteraction, success: boolean, title: string, details: string): Promise<void> {
        const layoutKey = success ? 'layouts.containerSuccess' : 'layouts.containerError';
        const rawJson = this.t(layoutKey, { title });
        
        const layout: Cv2LayoutSpec = JSON.parse(rawJson);
        const container = layout.components[0] as any;
        
        container.children[2].content = details;

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
                choices = files.filter(f => f.endsWith('.json5')).map(f => f.replace('.json5', ''));
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
                choices = entries.filter(e => e.isDirectory()).map(e => e.name);
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