import 'dotenv/config';
import { secrets } from '#core/helpers/secretManager.js';
import { Client, Partials, Events } from 'discord.js';
import { intentBuilder } from '#core/helpers/intentsBuilder.js';
import { getLogger } from '#core/utils/logger.js';
import { PluginManager } from '#core/loader/index.js';
import { httpServer } from '#core/manager/http/server.js';
import { interactionHandler } from '#core/manager/interaction/handler.js';
import { performance } from 'node:perf_hooks';
import { common777 } from '#core/internal/common777.js';
import { eventManager } from '#core/manager/events/Manager.js';
import { flushLogs } from '#core/utils/logger.js';
import { initAllDatabases } from '#core/database.js';
class NovaX {
    private readonly log = getLogger('Core');
    private readonly client: Client<true>;
    private readonly pluginManager: PluginManager;
    private isShuttingDown = false;
    
    constructor() {
        this.log.info('Setting Up Secret Manager...');
        secrets.assimilateEnv();
        secrets.lock();
        const intentsInput = secrets.getOptional('DiscordIntents')
            ? secrets.get('DiscordIntents').split(',').map(s => s.trim())
            : undefined;

        const intents = intentBuilder.build(intentsInput);

        this.client = new Client({
            intents,
            partials: [
                Partials.Channel,
                Partials.Message,
                Partials.User,
                Partials.GuildMember
            ]
        }) as Client<true>;

        eventManager.bindNativeEvents(this.client);
        this.pluginManager = new PluginManager();
    }

    public async bootstrap(): Promise<void> {
        const start = performance.now();
        this.log.info('Booting NovaX...');

        try {
            this.log.info('Initializing Databases...');
            await initAllDatabases();
            this.log.info('Initializing Interaction Handler...');
            interactionHandler.init();
            await this.login();
            this.log.info('Initializing Http Server...');
            httpServer.init();
            await httpServer.start();
            this.log.info('Booting Plugins...');
            await this.pluginManager.bootAll(this.client);
            this.log.info('Syncing Commands...');
            await interactionHandler.syncCommands(this.client, process.env.GuildID);
            const duration = ((performance.now() - start) / 1000).toFixed(2);
            this.log.info(`NovaX fully initialized in ${duration}s.`);
            this.log.info('Throwing several keywords to let pterodactyl know the bot has started...');
            this.log.info('Keywords: Bot Online, Running, Active, Bot Active, Bot Running, Ready, Bot Ready, Logged in, The bot is online, Started successfully, Server up and running');
            this.setupProcessSignals();
        } catch (error) {
            this.log.error('Critical failure during bootstrap sequence:');
            console.error(error);
            process.exit(1);
        }   
    }

    private async login(): Promise<void> {
        return new Promise((resolve) => {
            this.client.once(Events.ClientReady, (readyClient) => {
                this.log.info(`Connected to Discord Gateway as ${readyClient.user.tag}`);
                resolve();
            });

            try {
                const token = secrets.get('DiscordToken');
                this.client.login(token);
            } catch (error) {
                this.log.error('Failed to retrieve DiscordToken from Memory Vault. Is it in your common.json or .env?');
                process.exit(1);
            }
        });
    }

    private setupProcessSignals(): void {
        const shutdown = async (signal: string) => {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;

            this.log.warn(`[${signal}] Shutdown signal received. Initiating graceful exit...`);

            try {
                await this.pluginManager.shutdownAll();
                await httpServer.stop();
                this.client.destroy();
                this.log.info('NovaX shut down cleanly. Goodbye!');
                await new Promise(r => setTimeout(r, 500));
                await flushLogs();
                setImmediate(() => {
                    process.exit(0);
                });
            } catch (error) {
                this.log.error('Error during shutdown sequence:', error);
                await flushLogs().catch(() => {});
                process.exit(1);
            }
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    }
}
if (!process.env.NODE_ENV) {
    try {
        const fs = await import('node:fs');
        if (!fs.existsSync('.env')) {
            process.env.NODE_ENV = 'production';
        }
    } catch {
        process.env.NODE_ENV = 'production';
    }
}
if (!process.env.NODE_ENV || process.env.NODE_ENV.trim() === '') {
  process.env.NODE_ENV = 'production';
}
common777.bootstrap();
const app = new NovaX();
app.bootstrap();