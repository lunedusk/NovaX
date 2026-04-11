import { interactionRegistry } from '#core/manager/interaction/registry.js';

export type DiscordDomain = {
    readonly interactions: typeof interactionRegistry;
};

export const discordDomain = Object.freeze({
    interactions: interactionRegistry
});