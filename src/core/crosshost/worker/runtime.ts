import {
    Client,
    type Client as DiscordClient,
} from 'discord.js';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { pluginManager } from '#core/loader/index.js';
import type { AssignmentUpdateMessage, IdentifyGrantMessage } from '../types.js';
import { workerHooks } from './hooks.js';
import { IdentifyGrantWaiter } from './identifyClient.js';
import { SnapshotCache } from './snapshotCache.js';
import {
    createDiscordShardAdapter,
    type DiscordShardAdapter,
} from '#core/manager/discordShardAdapter.js';

const log = getLogger('CrossHost:WorkerRuntime');

let infrastructureInflight: Promise<void> | null = null;

export interface WorkerRuntimeState {
    readonly machineId: string;
    readonly snapshotCache: SnapshotCache;
    readonly grantWaiter: IdentifyGrantWaiter;
    readonly shardAdapter: DiscordShardAdapter;
    generation: number;
    totalShards: number;
    shards: number[];
    pluginsPreloaded: boolean;
    pluginsBooted: boolean;
    infrastructureReady: boolean;
    commandsSynced: boolean;
    client: DiscordClient | null;
}

export function createWorkerRuntimeState(
    machineId: string,
    totalShards: number,
    initialShards: readonly number[],
    generation: number,
): WorkerRuntimeState {
    return {
        machineId,
        snapshotCache: new SnapshotCache(),
        grantWaiter: new IdentifyGrantWaiter(),
        shardAdapter: createDiscordShardAdapter(),
        generation,
        totalShards,
        shards: [...initialShards],
        pluginsPreloaded: false,
        pluginsBooted: false,
        infrastructureReady: false,
        commandsSynced: false,
        client: null,
    };
}

function sameShardSet(a: readonly number[], b: readonly number[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort((x, y) => x - y);
    const sb = [...b].sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
}

export async function ensurePluginsPreloaded(state: WorkerRuntimeState): Promise<void> {
    if (state.pluginsPreloaded) return;
    log.info('Preloading plugins after snapshot hydrate');
    await pluginManager.preloadAll();
    state.pluginsPreloaded = true;
}

async function disableFailedMigrationPlugins(failedPlugins: readonly string[]): Promise<void> {
    for (const pluginId of failedPlugins) {
        log.error(`Disabling plugin after migration failure: ${pluginId}`);
        pluginManager.excludePreloadedPlugin(pluginId, 'migration_failed');
        try {
            await pluginManager.disable(pluginId);
        } catch (err) {
            log.warn(`Error disabling plugin ${pluginId}`, err);
        }
    }
}

async function ensureWorkerInfrastructure(state: WorkerRuntimeState): Promise<void> {
    if (state.infrastructureReady) return;
    if (infrastructureInflight) {
        await infrastructureInflight;
        return;
    }

    infrastructureInflight = (async () => {
        log.info('Initializing worker infrastructure (middleware, databases, permissions, interactions)');

        const { DiscordMiddleware } = await import('#core/manager/discordMiddleware.js');
        DiscordMiddleware.apply();

        const { initAllDatabases } = await import('#core/database/bootstrap.js');
        await initAllDatabases();

        const { runAllMigrations } = await import('#core/database/migrations/runner.js');
        const pluginMigrationSources = pluginManager.getPreloadedPluginDirs
            ? pluginManager.getPreloadedPluginDirs()
            : [];
        const { failedPlugins } = await runAllMigrations({ plugins: pluginMigrationSources });
        if (failedPlugins.length > 0) {
            await disableFailedMigrationPlugins(failedPlugins);
        }

        const { createPermissionsManager } = await import('#core/manager/permissions.js');
        const { createPermissionCache } = await import('#core/manager/permissionCache.js');
        const permMgr = createPermissionsManager();
        await permMgr.init();
        const permCache = createPermissionCache(permMgr);
        await permCache.init();
        permMgr.setCache(permCache);
        const { setHeartPermissions } = await import('#core/heart/index.js');
        setHeartPermissions(permMgr, permCache);

        const { interactionHandler } = await import('#core/manager/interaction/handler.js');
        interactionHandler.init();

        state.infrastructureReady = true;
        log.info('Worker infrastructure ready');
    })();

    try {
        await infrastructureInflight;
    } catch (err) {
        infrastructureInflight = null;
        throw err;
    }
}

async function interactionHandlerSync(client: DiscordClient): Promise<void> {
    const { interactionHandler } = await import('#core/manager/interaction/handler.js');
    await interactionHandler.syncCommands(client as Client<true>, secrets.getOptional('GuildID'));
}

async function trySyncCommandsOnce(client: DiscordClient, machineId: string): Promise<boolean> {
    try {
        const { redisDB } = await import('#core/database/redis.js');
        const { resolveCrossHostRedis } = await import('../env.js');
        const target = resolveCrossHostRedis();
        const redis = redisDB.get(target.alias);
        const key = 'zene:crosshost:command_sync_v1';
        const got = await redis.main.set(key, machineId, 'EX', 86400, 'NX');
        if (got !== 'OK') {
            log.info('Skipping command sync; another worker already holds the fleet lock', {
                machineId,
            });
            return false;
        }
    } catch (err) {
        log.warn('Command sync lock unavailable; syncing on this worker', err);
    }
    await interactionHandlerSync(client);
    return true;
}

export async function startClientIfNeeded(
    state: WorkerRuntimeState,
    _requestGrants: (shardIds: readonly number[]) => Promise<void>,
): Promise<void> {
    if (state.shards.length === 0) {
        log.info('Standby: zero shards assigned; login skipped');
        await state.shardAdapter.destroyAll();
        state.client = null;
        return;
    }

    await ensurePluginsPreloaded(state);
    await ensureWorkerInfrastructure(state);

    const waitForGrant = async (shardId: number): Promise<void> => {
        await state.grantWaiter.waitFor(shardId, 60_000);
    };

    await state.shardAdapter.applyShardSet(state.shards, state.totalShards, waitForGrant);

    const primary = state.shardAdapter.getPrimaryClient();
    state.client = primary;

    if (primary && !state.pluginsBooted) {
        log.info('Booting plugins on primary worker Client');
        await pluginManager.bootAll(primary as Client<true>);
        state.pluginsBooted = true;
    }

    if (primary && state.pluginsBooted && !state.commandsSynced) {
        try {
            const synced = await trySyncCommandsOnce(primary, state.machineId);
            if (synced) state.commandsSynced = true;
        } catch (err) {
            log.warn('Command sync on worker failed (non-fatal)', err);
        }
    }
}

export async function applyAssignment(
    state: WorkerRuntimeState,
    update: AssignmentUpdateMessage,
    requestGrants: (shardIds: readonly number[]) => Promise<void>,
): Promise<void> {
    if (update.generation < state.generation) {
        log.warn('Ignoring stale assignment', {
            have: state.generation,
            got: update.generation,
        });
        return;
    }
    if (
        update.generation === state.generation &&
        sameShardSet(state.shards, update.shards)
    ) {
        return;
    }

    const previous = [...state.shards];
    state.generation = update.generation;
    state.shards = [...update.shards];
    state.totalShards = update.totalShards;

    log.info('Applying assignment', {
        previous,
        next: state.shards,
        reason: update.reason,
        generation: update.generation,
    });

    void import('#core/manager/event.js')
        .then(({ eventBus }) =>
            eventBus.emitConcurrent('crosshost.assignment.applied', {
                machineId: state.machineId,
                previous,
                next: state.shards,
                reason: update.reason,
                generation: update.generation,
            }),
        )
        .catch(() => undefined);

    await workerHooks.runBeforeAssignment(state.shards, update.reason);
    await startClientIfNeeded(state, requestGrants);
    await workerHooks.runAfterAssignment(state.shards, update.reason);
}

export async function onIdentifyGrant(
    state: WorkerRuntimeState,
    grant: IdentifyGrantMessage,
): Promise<void> {
    if (!state.shards.includes(grant.shardId)) {
        log.warn('Ignoring identify grant for unassigned shard', {
            shardId: grant.shardId,
            assigned: state.shards,
        });
        return;
    }
    state.grantWaiter.deliver(grant);
}
