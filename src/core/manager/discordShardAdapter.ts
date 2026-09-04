import {
    Client,
    Partials,
    Events,
    type Client as DiscordClient,
} from 'discord.js';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { intentBuilder } from '#core/helpers/intentsBuilder.js';

const log = getLogger('DiscordShardAdapter');

export type ShardGrantWaiter = (shardId: number) => Promise<void>;

export interface DiscordShardAdapterStatus {
    readonly shards: readonly number[];
    readonly totalShards: number;
    readonly ready: boolean;
    readonly userTag: string | null;
}

interface ManagedShard {
    readonly shardId: number;
    client: DiscordClient;
    ready: boolean;
}

function sortedCopy(ids: readonly number[]): number[] {
    return [...ids].sort((a, b) => a - b);
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
    if (a.length !== b.length) return false;
    const sa = sortedCopy(a);
    const sb = sortedCopy(b);
    return sa.every((v, i) => v === sb[i]);
}

function buildShardClient(shardId: number, totalShards: number): DiscordClient {
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
        shards: [shardId],
        shardCount: totalShards,
    });
}

export class DiscordShardAdapter {
    private readonly managed = new Map<number, ManagedShard>();
    private totalShards = 1;
    private applyInflight: Promise<void> | null = null;

    public getClient(): DiscordClient | null {
        return this.getPrimaryClient();
    }

    public getPrimaryClient(): DiscordClient | null {
        const ids = sortedCopy([...this.managed.keys()]);
        if (ids.length === 0) return null;
        return this.managed.get(ids[0])?.client ?? null;
    }

    public getClientForShard(shardId: number): DiscordClient | null {
        return this.managed.get(shardId)?.client ?? null;
    }

    public getShardIds(): readonly number[] {
        return sortedCopy([...this.managed.keys()]);
    }

    public shardIdForGuild(guildId: string): number {
        const total = Math.max(1, this.totalShards);
        return Number((BigInt(guildId) >> 22n) % BigInt(total));
    }

    public getClientForGuild(guildId: string): DiscordClient | null {
        const shardId = this.shardIdForGuild(guildId);
        return this.getClientForShard(shardId);
    }

    public getGuild(guildId: string) {
        for (const entry of this.managed.values()) {
            const g = entry.client.guilds.cache.get(guildId);
            if (g) return g;
        }
        return null;
    }

    public getStatus(): DiscordShardAdapterStatus {
        const ids = this.getShardIds();
        const primary = this.getPrimaryClient();
        const allReady =
            ids.length > 0 && ids.every((id) => this.managed.get(id)?.ready === true);
        return {
            shards: ids,
            totalShards: this.totalShards,
            ready: allReady,
            userTag: primary?.user?.tag ?? null,
        };
    }

    public async applyShardSet(
        nextIds: readonly number[],
        totalShards: number,
        waitForGrant: ShardGrantWaiter,
    ): Promise<void> {
        if (this.applyInflight) {
            await this.applyInflight;
        }
        this.applyInflight = this.runApply(nextIds, totalShards, waitForGrant);
        try {
            await this.applyInflight;
        } finally {
            this.applyInflight = null;
        }
    }

    public async destroyAll(): Promise<void> {
        const ids = [...this.managed.keys()];
        for (const id of ids) {
            await this.dropShard(id);
        }
    }

    private async runApply(
        nextIds: readonly number[],
        totalShards: number,
        waitForGrant: ShardGrantWaiter,
    ): Promise<void> {
        const previousTotal = this.totalShards;
        this.totalShards = totalShards;
        const next = sortedCopy(nextIds);
        const current = new Set(this.managed.keys());
        const nextSet = new Set(next);

        if (next.length === 0) {
            for (const id of [...current]) {
                await this.dropShard(id);
            }
            log.info('Shard set empty; all connections down');
            return;
        }

        const setUnchanged = sameSet([...current], next);
        if (setUnchanged && previousTotal === totalShards) {
            const allReady = next.every((id) => this.managed.get(id)?.ready === true);
            if (allReady) {
                log.debug('Shard set unchanged; connections left intact', { shards: next });
                return;
            }
        }

        let toRemove = [...current].filter((id) => !nextSet.has(id));
        let toAdd = next.filter((id) => !current.has(id));
        if (setUnchanged && previousTotal !== totalShards) {
            toRemove = [...current];
            toAdd = [...next];
            log.info('totalShards changed; recreating shard clients', {
                previousTotal,
                totalShards,
            });
        }

        for (const shardId of toRemove) {
            await this.dropShard(shardId);
        }

        for (const shardId of toAdd) {
            await this.spawnShard(shardId, waitForGrant);
        }

        log.info('Shard set applied (diff)', {
            added: toAdd,
            removed: toRemove,
            live: this.getShardIds(),
            totalShards,
        });
        void import('#core/manager/event.js').then(({ eventBus }) =>
            eventBus.emitConcurrent('shard.set.changed', {
                previous: [...current],
                next,
                totalShards,
                reason: 'applyShardSet',
            }),
        ).catch(() => undefined);
    }

    private async spawnShard(
        shardId: number,
        waitForGrant: ShardGrantWaiter,
    ): Promise<void> {
        if (this.managed.has(shardId)) {
            const existing = this.managed.get(shardId);
            if (existing?.ready) return;
        }

        await waitForGrant(shardId);

        const client = buildShardClient(shardId, this.totalShards);
        const entry: ManagedShard = { shardId, client, ready: false };
        this.managed.set(shardId, entry);

        const { eventManager } = await import('#core/manager/events/Manager.js');
        eventManager.bindNativeEvents(client);

        const token = secrets.get('DiscordToken');
        await new Promise<void>((resolve, reject) => {
            const onReady = () => {
                entry.ready = true;
                log.info('Shard connection ready', {
                    shardId,
                    user: client.user?.tag,
                });
                void import('#core/manager/event.js').then(({ eventBus }) =>
                    eventBus.emitConcurrent('shard.ready', {
                        shardId,
                        totalShards: this.totalShards,
                        userTag: client.user?.tag ?? null,
                    }),
                ).catch(() => undefined);
                resolve();
            };
            client.once(Events.ClientReady, onReady);
            client.login(token).catch((err: unknown) => {
                client.off(Events.ClientReady, onReady);
                this.managed.delete(shardId);
                try {
                    client.destroy();
                } catch {

                }
                reject(err);
            });
        });
    }

    private async dropShard(shardId: number): Promise<void> {
        const entry = this.managed.get(shardId);
        if (!entry) return;
        this.managed.delete(shardId);
        try {
            const { eventManager } = await import('#core/manager/events/Manager.js');
            if (typeof eventManager.unbindClient === 'function') {
                eventManager.unbindClient(entry.client);
            }
        } catch {

        }
        try {
            entry.client.destroy();
        } catch (err) {
            log.warn('Shard client destroy error', { shardId, err });
        }
        log.info('Shard connection dropped', { shardId });
        void import('#core/manager/event.js').then(({ eventBus }) =>
            eventBus.emitConcurrent('shard.disconnect', { shardId, reason: 'drop' }),
        ).catch(() => undefined);
    }
}

export function createDiscordShardAdapter(): DiscordShardAdapter {
    return new DiscordShardAdapter();
}

let activeAdapter: DiscordShardAdapter | null = null;

export function getActiveDiscordShardAdapter(): DiscordShardAdapter | null {
    return activeAdapter;
}

export function setActiveDiscordShardAdapter(adapter: DiscordShardAdapter | null): void {
    activeAdapter = adapter;
}
