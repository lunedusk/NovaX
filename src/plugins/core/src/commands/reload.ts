import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';

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
        autoDefer: 'ephemeral',
        allowInDm: true
    };

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand(true);

        try {
            switch (subcommand) {
                case 'config': {
                    const file = interaction.options.getString('file');
                    const manager = (this.heart.assets.config as any);
                    
                    if (!file || file === 'all') {
                        const success = await manager.reloadAll();
                        return this.replyStatus(interaction, success, 'Configuration', 'all');
                    }
                    
                    const success = await manager.reloadFile(file);
                    return this.replyStatus(interaction, success, 'Configuration', file);
                }

                case 'lang': {
                    const namespace = interaction.options.getString('namespace');
                    const manager = (this.heart.assets.lang as any);
                    
                    if (!namespace || namespace === 'all') {
                        const success = await manager.reloadAll();
                        return this.replyStatus(interaction, success, 'Language', 'all');
                    }
                    
                    const success = await manager.reloadFile(namespace);
                    return this.replyStatus(interaction, success, 'Language', namespace);
                }

                case 'emoji': {
                    const manager = (this.heart.assets as any).emojis 
                        ?? ((await import('#core/loader/emoji.js').catch(() => null)) as any)?.emojis 
                        ?? ((await import('#core/helpers/emojiSync.js').catch(() => null)) as any)?.emojis;

                    if (!manager) throw new Error('EmojiManager is not accessible on IHeart or via known core paths.');

                    const success = await manager.reload();
                    return this.replyStatus(interaction, success, 'Emoji', 'global map');
                }

                case 'plugin': {
                    const pluginId = interaction.options.getString('id', true);
                    
                    const manager = (this.heart.system as any).plugins 
                        ?? ((await import('#core/loader/index.js').catch(() => null)) as any)?.pluginManager;

                    if (!manager) throw new Error('PluginManager is not accessible on IHeart or via known core paths.');
                    
                    const results = await manager.reload(pluginId, interaction.client);
                    const success = results.success.includes(pluginId);
                    return this.replyStatus(interaction, success, 'Plugin', pluginId);
                }
            }
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Reload Command Exception: ${err.message}`);
            await interaction.editReply(this.t('commands.reload.failed', { type: subcommand, target: 'execution' }));
        }
    }

    private async replyStatus(interaction: ChatInputCommandInteraction, success: boolean, type: string, target: string): Promise<void> {
        const key = target === 'all' ? 'commands.reload.allSuccess' : (success ? 'commands.reload.success' : 'commands.reload.failed');
        await interaction.editReply(this.t(key, { type, target }));
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