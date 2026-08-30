import {
    CrossGuildResolver,
    createServerAutocomplete,
    type EligibleGuild,
    type EligibilityFilter,
} from '#core/helpers/crossGuild/index.js';

export type GuildDomain = {
    readonly CrossGuildResolver: typeof CrossGuildResolver;
    readonly createServerAutocomplete: typeof createServerAutocomplete;
};

export type { EligibleGuild, EligibilityFilter };

export const guildDomain: GuildDomain = Object.freeze({
    CrossGuildResolver,
    createServerAutocomplete,
});
