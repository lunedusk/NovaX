import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';
import { ActivityType, type PresenceStatusData, type Client } from 'discord.js';
import { guildGate } from '#core/manager/guildGate.js';

type ConfigActivityType = 'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING' | 'COMPETING' | 'CUSTOM';

interface ActivityConfig {
    name: string;
    type: ConfigActivityType;
    url?: string;
}

interface PresenceConfig {
    enabled: boolean;
    updateIntervalSeconds: number;
    status: PresenceStatusData;
    activities: ActivityConfig[];
    guildGate?: {
        engine?: string;
        alias?: string;
    };
    help?: {
        filterByPermissions?: boolean;
        maxCharsPerPage?: number;
        ephemeral?: boolean;
    };
}

export default class Core extends BasePlugin {
    public readonly manifest: PluginManifest = {
        id: 'core',
        name: 'Core',
        version: '0.2.0',
        author: 'Lunedusk',
        novax_version: '>=0.1.20',
        dependencies: ['api', 'permissions']
    };

    private config!: PresenceConfig;
    private rotationTimer: NodeJS.Timeout | null = null;
    private currentIndex = 0;
    private gatesOk = false;

    private readonly ActivityTypeMap: Record<string, ActivityType> = {
        PLAYING: ActivityType.Playing,
        STREAMING: ActivityType.Streaming,
        LISTENING: ActivityType.Listening,
        WATCHING: ActivityType.Watching,
        COMPETING: ActivityType.Competing,
        CUSTOM: ActivityType.Custom
    };

    public async onSetup(): Promise<void> {
        this.log.info('Fetching presence configuration...');

        const rawConfig = this.heart.assets.config.get<PresenceConfig>('core');

        if (!rawConfig) {
            this.log.warn('No core config found. Presence engine disabled; attempting default guildGate sqlite.');
            this.config = {
                enabled: false,
                updateIntervalSeconds: 0,
                status: 'online',
                activities: [],
                guildGate: { engine: 'sqlite', alias: 'main' }
            };
        } else {
            this.config = rawConfig;
        }

        const gg = this.config.guildGate ?? { engine: 'sqlite', alias: 'main' };
        try {
            await guildGate.init({ engine: gg.engine, alias: gg.alias });
            this.gatesOk = true;
        } catch (e1) {
            this.log.warn(
                `GuildGate init failed (${gg.engine}/${gg.alias}): ${(e1 as Error).message}. Falling back to sqlite/main.`
            );
            try {
                await guildGate.init({ engine: 'sqlite', alias: 'main' });
                this.gatesOk = true;
            } catch (e2) {
                this.log.error(
                    `GuildGate fallback sqlite/main failed: ${(e2 as Error).message}. Core plugin will disable.`
                );
                this.gatesOk = false;
                throw new Error('Core disabled: no usable database for guild gates (sqlite/postgres/mongo).');
            }
        }
    }

    public async onEnable(): Promise<void> {
        if (!this.gatesOk) {
            this.log.error('Guild gates not ready — core should not have enabled.');
            return;
        }

        if (!this.config?.enabled || !this.config?.activities?.length) {
            this.log.warn('Presence engine is disabled or has no activities configured. Idling.');
            return;
        }

        const client = (this.heart as any).client as Client<true>;
        if (!client) {
            throw new Error('Fatal: Discord Client is not accessible on the Heart object.');
        }

        this.applyPresence(client);

        if (this.config.activities.length > 1) {
            const intervalMs = Math.max(this.config.updateIntervalSeconds * 1000, 15000);
            this.rotationTimer = setInterval(() => {
                this.currentIndex = (this.currentIndex + 1) % this.config.activities.length;
                this.applyPresence(client);
            }, intervalMs);
            this.log.info(
                `Presence rotation engine active. Cycling ${this.config.activities.length} activities every ${intervalMs / 1000}s.`
            );
        } else {
            this.log.info('Static presence locked and applied.');
        }
    }

    public async onDisable(): Promise<void> {
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
            this.rotationTimer = null;
            this.log.debug('Rotation loop terminated gracefully.');
        }

        const client = (this.heart as any).client as Client<true>;
        if (client && this.config?.enabled) {
            client.user.setPresence({ activities: [], status: 'online' });
            this.log.info('Presence purged from Discord Gateway.');
        }
    }

    private applyPresence(client: Client<true>): void {
        const activity = this.config.activities[this.currentIndex];
        const rawType = activity.type?.toUpperCase() || 'PLAYING';
        const typeEnum = this.ActivityTypeMap[rawType] ?? ActivityType.Playing;

        try {
            client.user.setPresence({
                status: this.config.status ?? 'online',
                activities: [
                    {
                        name: activity.name,
                        type: typeEnum as any,
                        url: typeEnum === ActivityType.Streaming ? activity.url : undefined
                    }
                ]
            });
            this.log.debug(`Presence updated -> [${rawType}] ${activity.name}`);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Failed to update presence to Discord Gateway: ${err.message}`);
        }
    }
}
