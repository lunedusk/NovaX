import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';
import { ActivityType, type PresenceStatusData, type Client } from 'discord.js';

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
}

export default class NovaCorePresence extends BasePlugin {
    public readonly manifest: PluginManifest = {
        id: 'core',
        name: 'Core',
        version: '0.1.0',
        author: 'NovaCore Development',
        novax_version: '0.1.0'
    };

    private config!: PresenceConfig;
    private rotationTimer: NodeJS.Timeout | null = null;
    private currentIndex = 0;

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
        
        const rawConfig = (this as any).heart?.assets?.config?.get('core');
        
        if (!rawConfig) {
            this.log.warn('No presence.json5 found. The presence engine will remain disabled.');
            this.config = {
                enabled: false,
                updateIntervalSeconds: 0,
                status: 'online',
                activities: []
            };
            return;
        }

        this.config = rawConfig as PresenceConfig;
    }

    public async onEnable(): Promise<void> {
        if (!this.config?.enabled || !this.config?.activities?.length) {
            this.log.warn('Presence engine is disabled or has no activities configured. Idling.');
            return;
        }

        const h = this.heart as any;
        const client = (h.client || h.discord?.client || h.baseClient || h.core) as Client<true>;
        
        if (!client) {
            this.log.error(`Available Heart keys: ${Object.keys(h).join(', ')}`);
            throw new Error('Fatal: Discord Client is not accessible. Check the logs above to see which keys are available on your Heart object.');
        }

        this.applyPresence(client);

        if (this.config.activities.length > 1) {
            const intervalMs = Math.max(this.config.updateIntervalSeconds * 1000, 15000); 
            
            this.rotationTimer = setInterval(() => {
                this.currentIndex = (this.currentIndex + 1) % this.config.activities.length;
                this.applyPresence(client);
            }, intervalMs);

            this.log.info(`Presence rotation engine active. Cycling ${this.config.activities.length} activities every ${intervalMs / 1000}s.`);
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

        const h = this.heart as any;
        const client = (h.client || h.discord?.client || h.baseClient || h.core) as Client<true>;
        
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
                activities: [{
                    name: activity.name,
                    type: typeEnum as any, 
                    url: typeEnum === ActivityType.Streaming ? activity.url : undefined
                }]
            });
            this.log.debug(`Presence updated -> [${rawType}] ${activity.name}`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Failed to update presence to Discord Gateway: ${err.message}`);
        }
    }
}