import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction, type AutocompleteInteraction, MessageFlags } from 'discord.js';
import { CrossGuildResolver } from '#core/helpers/crossGuild/resolver.js';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';

export default class CacheCommand extends BaseCommand {

    public readonly data = new SlashCommandBuilder()
        .setName('cache')
        .setDescription(this.t('commands.cache.description'))
        .addSubcommand(sub =>
            sub.setName('pop')
               .setDescription(this.t('commands.cache.popDescription'))
               .addStringOption(opt =>
                   opt.setName('target')
                      .setDescription(this.t('commands.cache.targetDescription'))
                      .setAutocomplete(true)
                      .setRequired(true)
               )
        );

    public readonly config: CommandConfig = {
        permissionLevel: 'owner',
        autoDefer: false,
        allowInDm: true
    };

    private readonly KNOWN_CACHES = [
        'cross-guild'
    ];

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const target = interaction.options.getString('target', true).toLowerCase();

        try {
            let success = false;
            let details = '';

            switch (target) {
                case 'cross-guild':
                    CrossGuildResolver.clearCache();
                    success = true;
                    details = this.t('commands.cache.messages.popped', { target });
                    break;
                default:
                    success = false;
                    details = this.t('commands.cache.messages.unknown', { target });
                    break;
            }

            await this.replyContainer(interaction, success, 'Cache Manager', details);

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Cache Command Exception: ${err.message}`);
            
            const details = this.t('commands.cache.messages.fatalError', { error: err.message });
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
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = this.KNOWN_CACHES
            .filter(c => c.includes(focused))
            .map(c => ({ name: c, value: c }));

        await interaction.respond(choices);
    }
}