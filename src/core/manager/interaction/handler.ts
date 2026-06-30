import {
    type Interaction,
    Events,
    MessageFlags,
    type InteractionReplyOptions,
    REST,
    Routes,
    type Client
} from 'discord.js';
import { performance } from 'node:perf_hooks';

import { interactionRegistry } from './registry.js';
import { eventBus } from '#core/manager/event.js';
import { getLogger } from '#core/utils/logger.js';
import { cooldownManager } from '#core/manager/cooldown.js';
import { metricsManager } from '#core/manager/metrics/index.js';
import { secrets } from '#core/helpers/secretManager.js';
import { resolveGlobalPlaceholders } from '#core/builders/helpers/string.js';
import { permissionsManager, type RouteAccessConfig } from '#core/manager/permissions.js';
import { CrossGuildResolver } from '#core/helpers/crossGuild/index.js';

const log = getLogger('InteractionHandler');

type InteractionCategory = 'chat_command' | 'autocomplete' | 'button' | 'select_menu' | 'modal' | 'context_menu' | 'UNKNOWN';

interface ResolvedRoute {
    category: InteractionCategory;
    lookupKey: string;
    handler?: (interaction: any) => Promise<void>;
    access?: RouteAccessConfig;
}

export class InteractionHandler {
    private restClient: REST | null = null;

    public init(): void {
        eventBus.on(`discord.${Events.InteractionCreate}`, async (interaction: Interaction) => {
            this.process(interaction).catch((error: unknown) => {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`Catastrophic failure in Interaction Pipeline: ${err.message}`, { stack: err.stack });
            });
        });
        log.info('Interaction Handler initialized and listening.');
    }

    public async syncCommands(client: Client<true>, guildId?: string): Promise<void> {
        if (!this.restClient) {
            this.restClient = new REST({ version: '10' }).setToken(secrets.get('DiscordToken'));
        }

        try {
            const chatEntries = interactionRegistry.chat.getEntries();
            const contextEntries = interactionRegistry.context.getEntries();

            const commandData = [
                ...Array.from(chatEntries.values()),
                ...Array.from(contextEntries.values())
            ]
            .filter(entry => entry.metadata?.data?.toJSON)
            .map(entry => entry.metadata!.data!.toJSON());

            if (commandData.length === 0) {
                log.warn('Command synchronization aborted: No valid command metadata found in registry.');
                return;
            }

            log.info(`Synchronizing ${commandData.length} interaction commands with Discord...`);

            const appId = client.user.id;
            const route = guildId
                ? Routes.applicationGuildCommands(appId, guildId)
                : Routes.applicationCommands(appId);

            await this.restClient.put(route, { body: commandData });

            log.info(`Successfully deployed commands ${guildId ? `to guild [${guildId}]` : 'globally'}.`);

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Failed to synchronize commands with Discord API: ${err.message}`);
            throw err;
        }
    }

    public clearCrossGuildCache(): void {
        CrossGuildResolver.clearCache();
    }

    public clearUserCrossGuildCache(userId: string): void {
        CrossGuildResolver.clearUserCache(userId);
    }

    private async process(interaction: Interaction): Promise<void> {
        const startTime = performance.now();
        const route = this.resolveRoute(interaction);
        let isSuccess = false;

        const endDurationTimer = metricsManager.interactionDuration.startTimer();

        try {
            if (!route.handler) {
                log.debug(`Unmapped interaction route: [${route.lookupKey}]`);
                metricsManager.interactionsTotal.inc({ type: route.category, command: route.lookupKey, status: 'unmapped' });
                return;
            }

            const access = await permissionsManager!.canExecute(interaction, route.access);
            if (!access.allowed) {
                metricsManager.interactionsTotal.inc({ type: route.category, command: route.lookupKey, status: 'denied' });

                if (interaction.isAutocomplete()) {
                    await interaction.respond([]).catch(() => {});
                    return;
                }

                await permissionsManager!.sendDenied(interaction, access.reason);
                return;
            }

            if (!interaction.isAutocomplete()) {
                const isGlobalEnabled = secrets.getBoolean('EnableGlobalRatelimit', true);

                if (isGlobalEnabled) {
                    const cooldown = await cooldownManager.isRateLimited('global', {
                        userId: interaction.user.id,
                        guildId: interaction.guildId ?? 'dm',
                        commandId: route.lookupKey
                    });

                    if (cooldown.limited) {
                        metricsManager.rateLimitsTotal.inc({ bucket: 'global' });
                        metricsManager.interactionsTotal.inc({ type: route.category, command: route.lookupKey, status: 'rate_limited' });
                        await this.sendSystemState(interaction, 'RATE_LIMIT', cooldown.remaining);
                        return;
                    }
                }
            }

            await route.handler(interaction);
            isSuccess = true;

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`[Execution Error] Route: ${route.lookupKey} | MSG: ${err.message}`, { stack: err.stack });

            await this.sendSystemState(interaction, 'FATAL_ERROR');
        } finally {
            const execTime = performance.now() - startTime;

            endDurationTimer({ command: route.lookupKey });

            metricsManager.interactionsTotal.inc({
                type: route.category,
                command: route.lookupKey,
                status: isSuccess ? 'success' : 'error'
            });

            if (execTime > 5000 && !interaction.isAutocomplete()) {
                log.warn(`[Telemetry] ${route.lookupKey} exceeded performance threshold (${execTime.toFixed(2)}ms).`);
            }
        }
    }

    private resolveRoute(interaction: Interaction): ResolvedRoute {
        if (interaction.isChatInputCommand()) {
            const resolved = interactionRegistry.chat.resolve(interaction.commandName);
            return { category: 'chat_command', lookupKey: interaction.commandName, handler: resolved?.handler, access: resolved?.metadata?.access };
        }
        if (interaction.isAutocomplete()) {
            const resolved = interactionRegistry.autocomplete.resolve(interaction.commandName);
            return { category: 'autocomplete', lookupKey: interaction.commandName, handler: resolved?.handler, access: resolved?.metadata?.access };
        }
        if (interaction.isButton()) {
            const resolved = interactionRegistry.button.resolve(interaction.customId);
            return { category: 'button', lookupKey: interaction.customId, handler: resolved?.handler, access: resolved?.metadata?.access };
        }
        if (interaction.isAnySelectMenu()) {
            const resolved = interactionRegistry.select.resolve(interaction.customId);
            return { category: 'select_menu', lookupKey: interaction.customId, handler: resolved?.handler, access: resolved?.metadata?.access };
        }
        if (interaction.isModalSubmit()) {
            const resolved = interactionRegistry.modal.resolve(interaction.customId);
            return { category: 'modal', lookupKey: interaction.customId, handler: resolved?.handler, access: resolved?.metadata?.access };
        }
        if (interaction.isContextMenuCommand()) {
            const resolved = interactionRegistry.context.resolve(interaction.commandName);
            return { category: 'context_menu', lookupKey: interaction.commandName, handler: resolved?.handler, access: resolved?.metadata?.access };
        }

        return { category: 'UNKNOWN', lookupKey: 'UNKNOWN' };
    }

    private async sendSystemState(interaction: Interaction, state: 'FATAL_ERROR' | 'RATE_LIMIT', contextData?: number): Promise<void> {
        if (interaction.isAutocomplete()) {
            if (!interaction.responded) await interaction.respond([]).catch(() => {});
            return;
        }

        if (interaction.isRepliable()) {
            const payload: InteractionReplyOptions = {
                flags: [MessageFlags.Ephemeral]
            };

            switch (state) {
                case 'FATAL_ERROR':
                    payload.content = resolveGlobalPlaceholders('%%emoji_cross%% A critical internal error occurred while processing your request.');
                    break;
                case 'RATE_LIMIT':
                    const remainingSec = ((contextData ?? 0) / 1000).toFixed(1);
                    payload.content = resolveGlobalPlaceholders(`%%emoji_clock%% Please wait **${remainingSec}s** before interacting again.`);
                    break;
            }

            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp(payload);
                } else {
                    await interaction.reply(payload);
                }
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`Failed to dispatch system state [${state}]: ${err.message}`);
            }
        }
    }
}

export const interactionHandler = new InteractionHandler();