// plugins/core/src/commands/cache.ts
import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import { CrossGuildResolver } from '#core/helpers/crossGuild/resolver.js';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';

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
        autoDefer: false, // Handled manually to prevent background deferral races
        allowInDm: true
    };

    private readonly KNOWN_CACHES = [
        'cross-guild'
    ];

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ ephemeral: true });

        const target = interaction.options.getString('target', true).toLowerCase();
        let success = false;
        let details = '';

        try {
            switch (target) {
                case 'cross-guild':
                    CrossGuildResolver.clearCache();
                    success = true;
                    details = this.t('commands.cache.popped', { target });
                    break;
                default:
                    success = false;
                    details = this.t('commands.cache.unknown', { target });
                    break;
            }

            await this.replyContainer(interaction, success, 'Cache Manager', details);

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Cache Command Exception: ${err.message}`);
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
        const focused = interaction.options.getFocused().toLowerCase();
        
        const choices = this.KNOWN_CACHES
            .filter(c => c.includes(focused))
            .map(c => ({ name: c, value: c }));

        await interaction.respond(choices);
    }
}