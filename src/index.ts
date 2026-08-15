import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

if (!process.env.NODE_ENV || process.env.NODE_ENV.trim() === '') {
    process.env.NODE_ENV = 'production';
}

if (!process.env.PublicKey || process.env.PublicKey.trim() === '') {
    process.env.PublicKey = 'MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ=';
}

import { secrets } from '#core/helpers/secretManager.js';
import { common777 } from '#core/internal/common777.js';
import { getLogger, flushLogs } from '#core/utils/logger.js';

function minimalBootstrap(): void {
    secrets.assimilateEnv();
    secrets.lock();
    common777.bootstrap();
}

const isUpdaterOnly =
    process.argv.includes('--updater') ||
    process.env.UpdaterOnly === '1' ||
    process.env.UPDATER_ONLY === '1';

function readArgValue(names: string[]): string | null {
    for (let i = 0; i < process.argv.length; i++) {
        const a = process.argv[i];
        for (const name of names) {
            if (a === name) return process.argv[i + 1] ?? null;
            if (a.startsWith(name + '=')) return a.slice(name.length + 1) || null;
        }
    }
    return null;
}

async function runUpdaterMode(): Promise<void> {
    const logger = getLogger('Bootstrap');
    try {
        minimalBootstrap();
        const { runUpdater } = await import('#core/manager/updater/index.js');
        const force = process.argv.includes('--force');
        const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryRun');
        const baselineOnly = process.argv.includes('--baseline-only') || process.argv.includes('--baselineOnly');
        const downgrade = process.argv.includes('--downgrade');
        const listBackups = process.argv.includes('--list-backups') || process.argv.includes('--listBackups');
        const installPlugin = readArgValue(['--install-plugin', '--installPlugin']);
        const targetTag = readArgValue(['--target']);
        const pluginTag = readArgValue(['--plugin-tag', '--pluginTag']);
        const restoreBackup = readArgValue(['--restore-backup', '--restoreBackup']);

        await runUpdater({
            force,
            dryRun,
            baselineOnly,
            installPlugin,
            targetTag,
            downgrade,
            pluginTag,
            listBackups,
            restoreBackup
        });
        await flushLogs();
        process.exit(process.exitCode ?? 0);
    } catch (error) {
        logger.error('FATAL UPDATER CRASH:', error);
        process.exit(1);
    }
}

async function runBotMode(): Promise<void> {
    const {
        Client, Partials, Events, ShardingManager
    } = await import('discord.js');
    const { intentBuilder } = await import('#core/helpers/intentsBuilder.js');
    const { pluginManager } = await import('#core/loader/index.js');
    const { httpServer } = await import('#core/manager/http/server.js');
    const { DiscordMiddleware } = await import('#core/manager/discordMiddleware.js');
    const { interactionHandler } = await import('#core/manager/interaction/handler.js');
    const { configManager } = await import('#core/manager/config.js');
    const { i18n } = await import('#core/manager/lang.js');
    const { eventManager } = await import('#core/manager/events/Manager.js');
    const { initAllDatabases } = await import('#core/database.js');
    const { globalCatcher } = await import('#core/error/index.js');
    const { emojis } = await import('#core/manager/emoji.js');
    const { wireErrorBridge } = await import('#core/bootstrap/errorBridge.js');
    const { createPermissionsManager } = await import('#core/manager/permissions.js');
    const { createPermissionCache } = await import('#core/manager/permissionCache.js');

    class NovaX {
        private readonly log = getLogger('Bootstrap');
        private readonly client: InstanceType<typeof Client<true>>;
        private isShuttingDown = false;
        private stopBackgroundUpdater: (() => void) | null = null;
        
        constructor() {
            const intentsInput = secrets.getOptional('DiscordIntents')
                ? secrets.get('DiscordIntents').split(',').map(s => s.trim())
                : undefined;

            this.client = new Client({
                intents: intentBuilder.build(intentsInput),
                partials: [ Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember, Partials.Reaction, Partials.ThreadMember, Partials.GuildScheduledEvent ]
            }) as InstanceType<typeof Client<true>>;

            eventManager.bindNativeEvents(this.client);
            
            globalCatcher.init();
            wireErrorBridge();
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
                this.log.info('Initializing Discord Middleware...');
                DiscordMiddleware.apply();
                this.log.info('Preloading Plugins...');
                await pluginManager.preloadAll();

                this.log.info('Loading Configurations...');
                await configManager.init(hotReloadEnabled);
                
                this.log.info('Loading Language Dictionary...');
                await i18n.init(hotReloadEnabled);
                
                this.log.info('Initializing Databases...');
                await initAllDatabases();

                this.log.info('Initializing Permission System...');
                const permMgr = createPermissionsManager();
                await permMgr.init();
                const permCache = createPermissionCache(permMgr);
                await permCache.init();
                permMgr.setCache(permCache);

                this.log.info('Initializing Interaction Handler...');
                interactionHandler.init();

                
                await this.login();
                
                if (this.isPrimaryShard) {
                    httpServer.init();
                    await httpServer.start(parseInt(secrets.getOptional('APIPort') || '3000'));
                }

                this.log.info('Booting Plugins...');
                await pluginManager.bootAll(this.client);

                if (this.isPrimaryShard) {
                    httpServer.finalize();
                }

                await emojis.init(hotReloadEnabled);
                
                this.log.info('Syncing Commands...');
                await interactionHandler.syncCommands(this.client, secrets.getOptional('GuildID'));
                
                const duration = ((performance.now() - start) / 1000).toFixed(2);
                this.log.info(`NovaX fully initialized in ${duration}s.`);
                
                if (this.isPrimaryShard) {
                    this.log.info('Panel Status Override: Bot Online, Running, Active, Bot Ready, Logged in, Server up and running');
                    try {
                        const { markUpdaterHealthy, startBackgroundUpdater } =
                            await import('#core/manager/updater/index.js');
                        markUpdaterHealthy();
                        this.stopBackgroundUpdater = startBackgroundUpdater();
                    } catch (e) {
                        this.log.warn('Updater post-boot hooks failed:', e);
                    }
                }
            } catch (error) {
                this.log.error('Critical failure during bootstrap sequence:', error);
                throw error; 
            }   
        }

        private async login(): Promise<void> {
            return new Promise((resolve, reject) => {
                const onReady = (readyClient: InstanceType<typeof Client<true>>) => {
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
                this.stopBackgroundUpdater?.();
                this.stopBackgroundUpdater = null;
                await pluginManager.shutdownAll().catch((e: unknown) => this.log.error('Plugin shutdown error:', e));
                
                if (this.isPrimaryShard) {
                    await httpServer.stop().catch((e: unknown) => this.log.error('HTTP Server shutdown error:', e));
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

    const logger = getLogger('Bootstrap');
    const isSpawnedWorker = process.env.SHARD_LIST !== undefined || typeof process.send === 'function';

    try {
        minimalBootstrap();

        if (!isSpawnedWorker) {
            try {
                const { checkPendingRollbackOnBoot } = await import('#core/manager/updater/index.js');
                const rolled = await checkPendingRollbackOnBoot();
                if (rolled) {
                    logger.warn('Auto-rollback completed – exiting for clean restart');
                    await flushLogs();
                    process.exit(0);
                }
            } catch (e) {
                logger.warn('Pending-rollback check skipped:', e);
            }
        }
        
        const isSharded = secrets.getBoolean('isSharded', false);

        if (isSharded && !isSpawnedWorker) {
            const masterLog = getLogger('ShardingManager');
            masterLog.info('Booting into Sharded Mode...');

            const entryFile = fileURLToPath(import.meta.url);
            const manager = new ShardingManager(entryFile, {
                token: secrets.get('DiscordToken'),
                totalShards: 'auto',
                respawn: true
            });

            manager.on('shardCreate', shard => {
                masterLog.info(`Successfully launched Shard #${shard.id}`);
            });
            let masterShuttingDown = false;
            const shutdownMaster = () => {
                if (masterShuttingDown) return;
                masterShuttingDown = true;
                masterLog.warn('Shutting down. Broadcasting exit to fleet...');
                manager.respawn = false;
                setTimeout(() => process.exit(0), 2000); 
            };
            process.on('SIGTERM', shutdownMaster);
            process.on('SIGINT', shutdownMaster);

            await manager.spawn();
        } else {
            const app = new NovaX();
            await app.bootstrap();
        }
    } catch (error) {
        logger.error('FATAL APPLICATION CRASH:', error);
        process.exit(1);
    }
}

const BOOT_LOCK = Symbol.for('NOVAX_BOOT_LOCK');

if (!(globalThis as any)[BOOT_LOCK]) {
    (globalThis as any)[BOOT_LOCK] = true;

    if (isUpdaterOnly) {
        runUpdaterMode();
    } else {
        runBotMode();
    }
}