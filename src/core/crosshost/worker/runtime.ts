import {
    Client,
    Partials,
    Events,
    type Client as DiscordClient,
} from 'discord.js';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { intentBuilder } from '#core/helpers/intentsBuilder.js';
import { pluginManager } from '#core/loader/index.js';
import type { AssignmentReason, AssignmentUpdateMessage, IdentifyGrantMessage } from '../types.js';
import { workerHooks } from './hooks.js';
import { IdentifyGrantWaiter } from './identifyClient.js';
import { SnapshotCache } from './snapshotCache.js';

const log = getLogger('CrossHost:WorkerRuntime');

export interface WorkerRuntimeState {
    readonly machineId: string;
    readonly snapshotCache: SnapshotCache;
    readonly grantWaiter: IdentifyGrantWaiter;
    generation: number;
    totalShards: number;
    shards: number[];
    pluginsPreloaded: boolean;
    pluginsBooted: boolean;
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
        generation,
        totalShards,
        shards: [...initialShards],
        pluginsPreloaded: false,
        pluginsBooted: false,
        client: null,
    };
}

function sameShardSet(a: readonly number[], b: readonly number[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort((x, y) => x - y);
    const sb = [...b].sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
}

async function destroyClient(state: WorkerRuntimeState): Promise<void> {
    if (!state.client) return;
    try {
        state.client.destroy();
    } catch (err) {
        log.warn('Client destroy error', err);
    }
    state.client = null;
    state.pluginsBooted = false;
}

function buildClient(shards: readonly number[], totalShards: number): DiscordClient {
    const intentsInput = secrets.getOptional('DiscordIntents')
        ? secrets.get('DiscordIntents').split(',').map((s) => s.trim())
        : undefined;
    return new Client({
        intents: intentBuilder.build(intentsInput),
        partials: [
            Partials.Channel,
            Partials.Message,
            Partials.User,
            Partials.GuildMember,
            Partials.Reaction,
            Partials.ThreadMember,
            Partials.GuildScheduledEvent,
        ],
        shards: [...shards],
        shardCount: totalShards,
    });
}

export async function ensurePluginsPreloaded(state: WorkerRuntimeState): Promise<void> {
    if (state.pluginsPreloaded) return;
    log.info('Preloading plugins after snapshot hydrate');
    await pluginManager.preloadAll();
    state.pluginsPreloaded = true;
}

export async function startClientIfNeeded(
    state: WorkerRuntimeState,
    requestGrants: (shardIds: readonly number[]) => Promise<void>,
): Promise<void> {
    if (state.shards.length === 0) {
        log.info('Standby: zero shards assigned; login skipped');
        await destroyClient(state);
        return;
    }

    await ensurePluginsPreloaded(state);
    await requestGrants(state.shards);

    if (state.client) {
        await destroyClient(state);
    }

    const client = buildClient(state.shards, state.totalShards);
    state.client = client;

    await new Promise<void>((resolve, reject) => {
        const onReady = () => {
            log.info('Worker Client ready', {
                shards: state.shards,
                totalShards: state.totalShards,
                user: client.user?.tag,
            });
            resolve();
        };
        client.once(Events.ClientReady, onReady);
        client.login(secrets.get('DiscordToken')).catch((err: unknown) => {
            client.off(Events.ClientReady, onReady);
            reject(err);
        });
    });

    if (!state.pluginsBooted) {
        log.info('Booting plugins on worker Client');
        await pluginManager.bootAll(client as Client<true>);
        state.pluginsBooted = true;
    }
}

export async function applyAssignment(
    state: WorkerRuntimeState,
    update: AssignmentUpdateMessage,
    requestGrants: (shardIds: readonly number[]) => Promise<void>,
): Promise<void> {
    if (update.machineId !== state.machineId) return;
    if (update.generation < state.generation) {
        log.warn('Ignoring stale assignment', {
            messageGeneration: update.generation,
            localGeneration: state.generation,
        });
        return;
    }

    const previous = [...state.shards];
    const next = [...update.shards].sort((a, b) => a - b);
    state.generation = update.generation;
    state.totalShards = update.totalShards;

    if (sameShardSet(previous, next) && state.client) {
        log.info('Assignment unchanged', { shards: next, reason: update.reason });
        return;
    }

    const reason: AssignmentReason = update.reason;
    if (update.reason === 'drain' || (previous.length > 0 && next.length === 0)) {
        await workerHooks.runBeforeDrain(previous, reason);
        state.shards = next;
        await destroyClient(state);
        await workerHooks.runAfterDrain(previous, reason);
        log.info('Drain complete', { previous, reason });
        return;
    }

    await workerHooks.runBeforeAssignment(next, reason);
    state.shards = next;
    await startClientIfNeeded(state, requestGrants);
    await workerHooks.runAfterAssignment(next, reason);
    log.info('Assignment applied', {
        previous,
        next,
        reason,
        generation: state.generation,
    });
}

export function onIdentifyGrant(
    state: WorkerRuntimeState,
    grant: IdentifyGrantMessage,
): void {
    if (grant.machineId !== state.machineId) return;
    state.grantWaiter.deliver(grant);
}
