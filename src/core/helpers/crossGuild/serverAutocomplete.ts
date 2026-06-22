import type { AutocompleteInteraction } from 'discord.js';
import { CrossGuildResolver, type EligibilityFilter } from './resolver.js';

export function createServerAutocomplete(filter: EligibilityFilter) {
    return async (interaction: AutocompleteInteraction): Promise<void> => {
        const resolver = new CrossGuildResolver(interaction.client);
        const focused = interaction.options.getFocused().toLowerCase();

        const eligible = await resolver.getEligibleGuilds(interaction.user.id, filter);

        const choices = eligible
            .filter(e => e.guild.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(e => ({
                name: e.guild.name,
                value: e.guild.id
            }));

        await interaction.respond(choices);
    };
}
