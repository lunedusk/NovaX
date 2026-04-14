import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

if (!process.env.NODE_ENV || process.env.NODE_ENV.trim() === '') {
    process.env.NODE_ENV = 'production';
}

import { secrets } from '#core/helpers/secretManager.js';
import { Client, Partials, Events, ShardingManager } from 'discord.js';
import { intentBuilder } from '#core/helpers/intentsBuilder.js';
import { getLogger, flushLogs } from '#core/utils/logger.js';
import { PluginManager } from '#core/loader/index.js';
import { httpServer } from '#core/manager/http/server.js';
import { interactionHandler } from '#core/manager/interaction/handler.js';
import { configManager } from '#core/manager/config.js';
import { i18n } from '#core/manager/lang.js';
import { common777 } from '#core/internal/common777.js';
import { eventManager } from '#core/manager/events/Manager.js';
import { initAllDatabases } from '#core/database.js';
import { globalCatcher } from '#core/error/index.js';

class NovaX {
    private readonly log = getLogger('Bootstrap');
    private readonly client: Client<true>;
    private readonly pluginManager: PluginManager;
    private isShuttingDown = false;
    
    constructor() {
        const intentsInput = secrets.getOptional('DiscordIntents')
            ? secrets.get('DiscordIntents').split(',').map(s => s.trim())
            : undefined;

        this.client = new Client({
            intents: intentBuilder.build(intentsInput),
            partials: [ Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember ]
        }) as Client<true>;

        eventManager.bindNativeEvents(this.client);
        this.pluginManager = new PluginManager();
        
        globalCatcher.init();
        globalCatcher.registerTeardown(async () => await this.cleanupResources());

        this.setupProcessSignals();
    }

    private get isPrimaryShard(): boolean {
        const shards = this.client.options.shards;
        return !shards || (Array.isArray(shards) && shards[0] === 0) || shards === 0;
    }

    private get shardIdentifier(): string {
        const shards = this.client.options.shards;
        if (!shards) return '(Standalone)';
        return Array.isArray(shards) ? `(Shard ${shards.join(',')})` : `(Shard ${shards})`;
    }

    public async bootstrap(): Promise<void> {
        const start = performance.now();
        this.log.info(`Booting NovaX ${this.shardIdentifier} [${process.env.NODE_ENV}]...`);

        try {
            const hotReloadEnabled = secrets.getBoolean('hotReloadEnabled', false);
            
            this.log.info('Preloading Plugins...');
            await this.pluginManager.preloadAll();

            this.log.info('Loading Configurations...');
            await configManager.init(hotReloadEnabled);
            
            this.log.info('Loading Language Dictionary...');
            await i18n.init(hotReloadEnabled);
            
            this.log.info('Initializing Databases...');
            await initAllDatabases();
            
            this.log.info('Initializing Interaction Handler...');
            interactionHandler.init();
            
            await this.login();
            
            if (this.isPrimaryShard) {
                this.log.info('Initializing Http Server...');
                httpServer.init();
                await httpServer.start();
            }

            this.log.info('Booting Plugins...');
            await this.pluginManager.bootAll(this.client);
            
            this.log.info('Syncing Commands...');
            await interactionHandler.syncCommands(this.client, secrets.getOptional('GuildID'));
            
            const duration = ((performance.now() - start) / 1000).toFixed(2);
            this.log.info(`NovaX fully initialized in ${duration}s.`);
            
            if (this.isPrimaryShard) {
                this.log.info('Panel Status Override: Bot Online, Running, Active, Bot Ready, Logged in, Server up and running');
            }
        } catch (error) {
            this.log.error('Critical failure during bootstrap sequence:', error);
            throw error; 
        }   
    }

    private async login(): Promise<void> {
        return new Promise((resolve, reject) => {
            const onReady = (readyClient: Client<true>) => {
                this.log.info(`Connected to Discord Gateway as ${readyClient.user.tag}`);
                resolve();
            };

            this.client.once(Events.ClientReady, onReady);

            try {
                this.client.login(secrets.get('DiscordToken')).catch(error => {
                    this.client.off(Events.ClientReady, onReady);
                    reject(error);
                });
            } catch (error) {
                this.client.off(Events.ClientReady, onReady);
                reject(error);
            }
        });
    }

    private async cleanupResources(): Promise<void> {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        this.log.info(`Tearing down resources for ${this.shardIdentifier}...`);

        try {
            await this.pluginManager.shutdownAll().catch(e => this.log.error('Plugin shutdown error:', e));
            
            if (this.isPrimaryShard) {
                await httpServer.stop().catch(e => this.log.error('HTTP Server shutdown error:', e));
            }
            
            this.client.destroy();
            await new Promise(r => setTimeout(r, 250));
            await flushLogs();
        } catch (error) {
            this.log.error('Fatal error during resource cleanup:', error);
        }
    }

    private setupProcessSignals(): void {
        const handleSignal = async (signal: string) => {
            this.log.warn(`[${signal}] Signal received. Gracefully shutting down...`);
            await this.cleanupResources();
            process.exit(0);
        };

        process.on('SIGTERM', () => handleSignal('SIGTERM'));
        process.on('SIGINT', () => handleSignal('SIGINT'));
    }
}

async function main() {
    const logger = getLogger('Bootstrap');
    try {
        secrets.assimilateEnv();
        secrets.lock();
        const isSharded = secrets.getBoolean('isSharded', false);
        const isSpawnedWorker = 'SHARD_LIST' in process.env;

        if (isSharded && !isSpawnedWorker) {
            globalCatcher.init();
            
            const masterLog = getLogger('ShardingManager');
            masterLog.info('Booting into Enterprise Sharded Mode...');

            const entryFile = fileURLToPath(import.meta.url);
            const manager = new ShardingManager(entryFile, {
                token: secrets.get('DiscordToken'),
                totalShards: 'auto',
                respawn: true
            });

            manager.on('shardCreate', shard => {
                masterLog.info(`Successfully launched Shard #${shard.id}`);
            });

            const shutdownMaster = () => {
                masterLog.warn('[SIGTERM] Master shutting down. Broadcasting exit to fleet...');
                setTimeout(() => process.exit(0), 5000); 
            };
            process.on('SIGTERM', shutdownMaster);
            process.on('SIGINT', shutdownMaster);

            await manager.spawn();
        } else {
            common777.bootstrap();
            const app = new NovaX();
            await app.bootstrap();
        }
    } catch (error) {
        logger.error('FATAL APPLICATION CRASH:', error);
        process.exit(1);
    }
}

main();