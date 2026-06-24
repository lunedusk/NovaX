import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import { CrossGuildResolver } from '#core/helpers/crossGuild/resolver.js';

export default class CacheCommand extends BaseCommand {

    public readonly data = new SlashCommandBuilder()
        .setName('cache')
        .setDescription('Manage internal framework caches.')
        .addSubcommand(sub =>
            sub.setName('pop')
               .setDescription('Invalidate and clear a specific memory cache pool.')
               .addStringOption(opt =>
                   opt.setName('target')
                      .setDescription('The cache registry to drop')
                      .setAutocomplete(true)
                      .setRequired(true)
               )
        );

    public readonly config: CommandConfig = {
        permissionLevel: 'owner',
        autoDefer: 'ephemeral',
        allowInDm: true
    };

    private readonly KNOWN_CACHES = [
        'cross-guild'
    ];

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }

        const target = interaction.options.getString('target', true).toLowerCase();

        switch (target) {
            case 'cross-guild':
                CrossGuildResolver.clearCache();
                await interaction.editReply(this.t('commands.cache.popped', { target }));
                break;
            default:
                await interaction.editReply(this.t('commands.cache.unknown', { target }));
                break;
        }
    }

    public async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const focused = interaction.options.getFocused().toLowerCase();
        
        const choices = this.KNOWN_CACHES
            .filter(c => c.includes(focused))
            .map(c => ({ name: c, value: c }));

        await interaction.respond(choices);
    }
}