import { Client, Events } from 'discord.js';
import { eventBus } from '#core/manager/event.js';
import { getLogger } from '#core/utils/logger.js';
import { metricsManager } from '#core/manager/metrics/index.js';

const log = getLogger('EventManager');

export class EventManager {
    private readonly boundClients = new Set<Client>();
    private busHooksAttached = false;

    public bindNativeEvents(client: Client): void {
        if (this.boundClients.has(client)) {
            return;
        }

        log.info('Establishing EventBus bridge for Discord events...', {
            clientCount: this.boundClients.size + 1,
        });

        let boundCount = 0;

        for (const eventName of Object.values(Events)) {
            // @ts-expect-error: Dynamic event binding bypasses strict ClientEvents mapping
            client.on(eventName, (...args: unknown[]) => {
                try {
                    metricsManager.eventsTotal.inc({ event: eventName });

                    eventBus.emitConcurrent(`discord.${eventName}`, ...args)
                        .catch((promiseError: unknown) => {
                            this.logError(`Async EventBus error on discord.${eventName}`, promiseError);
                        });

                } catch (syncError: unknown) {
                    this.logError(`Sync EventBus error on discord.${eventName}`, syncError);
                }
            });
            boundCount++;
        }

        this.boundClients.add(client);
        log.info(`Bridged ${boundCount} dynamic Discord events.`, {
            boundClients: this.boundClients.size,
        });

        if (!this.busHooksAttached) {
            this.busHooksAttached = true;

            eventBus.on('discord.guildCreate', () => {
                let total = 0;
                for (const c of this.boundClients) {
                    total += c.guilds.cache.size;
                }
                metricsManager.activeGuilds.set(total);
            });

            eventBus.on('discord.guildDelete', () => {
                let total = 0;
                for (const c of this.boundClients) {
                    total += c.guilds.cache.size;
                }
                metricsManager.activeGuilds.set(total);
            });

            eventBus.once('discord.clientReady', (c: Client<true>) => {
                log.info(`Gateway Authenticated: ${c.user.tag}`);
                let total = 0;
                for (const bc of this.boundClients) {
                    total += bc.guilds.cache.size;
                }
                metricsManager.activeGuilds.set(total);

                eventBus.emitConcurrent('system.ready', c).catch(e => this.logError('System Ready Hook', e));
            });

            eventBus.on('discord.error', (err: Error) => {
                log.error(`Gateway Error: ${err.message}`);
            });
        }
    }

    public unbindClient(client: Client): void {
        this.boundClients.delete(client);
    }

    private logError(context: string, error: unknown): void {
        const err = error instanceof Error ? error : new Error(String(error));
        log.error(`${context}: ${err.message}`, { stack: err.stack });
    }
}

export const eventManager = new EventManager();
