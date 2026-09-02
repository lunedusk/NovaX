import { EventEmitter } from 'node:events';
import {
    DEFAULT_GATEWAY_URL,
    DEFAULT_MAX_CONCURRENCY,
} from './constants.js';
import { GatewayShard } from './GatewayShard.js';
import { IdentifyQueue } from './identifyQueue.js';
import { MemorySessionStore } from './sessionStore.js';
import type {
    GatewayBotInfo,
    GatewayMultiplexOptions,
    IdentifyProperties,
    MultiplexEvents,
    PresenceUpdateData,
    ReadyPayload,
    SessionStore,
    ShardStatus,
} from './types.js';

type EventMap = {
    [K in keyof MultiplexEvents]: MultiplexEvents[K];
};

export interface ShardInfo {
    readonly shardId: number;
    readonly status: ShardStatus;
}

export class GatewayMultiplex extends EventEmitter {
    private readonly token: string;
    private readonly intents: number;
    private shardCount: number;
    private maxConcurrency: number;
    private gatewayUrl: string;
    private readonly largeThreshold: number;
    private readonly properties: IdentifyProperties;
    private readonly presence: PresenceUpdateData | null;
    private readonly autoReconnect: boolean;
    private readonly sessionStore: SessionStore;
    private readonly identifyQueue: IdentifyQueue;
    private readonly shards = new Map<number, GatewayShard>();
    private readonly fetchGatewayBot: (() => Promise<GatewayBotInfo>) | null;
    private gatewayResolved = false;
    private applyLock: Promise<void> = Promise.resolve();

    public constructor(options: GatewayMultiplexOptions) {
        super();
        if (!options.token) throw new Error('token is required');
        if (!Number.isInteger(options.intents) || options.intents < 0) {
            throw new Error('intents must be a non-negative integer bitfield');
        }
        if (!Number.isInteger(options.shardCount) || options.shardCount < 1) {
            throw new Error('shardCount must be an integer >= 1');
        }

        this.token = options.token.startsWith('Bot ')
            ? options.token.slice(4)
            : options.token;
        this.intents = options.intents;
        this.shardCount = options.shardCount;
        this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
        this.gatewayUrl = options.gatewayUrl ?? DEFAULT_GATEWAY_URL;
        this.largeThreshold = options.largeThreshold ?? 250;
        this.properties = options.properties ?? {
            os: process.platform,
            browser: 'lunedusk-gateway-multiplex',
            device: 'lunedusk-gateway-multiplex',
        };
        this.presence = options.presence ?? null;
        this.autoReconnect = options.autoReconnect !== false;
        this.sessionStore = options.sessionStore ?? new MemorySessionStore();
        this.identifyQueue = new IdentifyQueue(this.maxConcurrency);
        this.fetchGatewayBot = options.fetchGatewayBot ?? null;
    }

    public override on<K extends keyof EventMap>(
        event: K,
        listener: (...args: EventMap[K]) => void,
    ): this;
    public override on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener);
    }

    public override once<K extends keyof EventMap>(
        event: K,
        listener: (...args: EventMap[K]) => void,
    ): this;
    public override once(event: string, listener: (...args: unknown[]) => void): this {
        return super.once(event, listener);
    }

    public getShardIds(): number[] {
        return [...this.shards.keys()].sort((a, b) => a - b);
    }

    public getShardStatus(shardId: number): ShardStatus | null {
        return this.shards.get(shardId)?.getStatus() ?? null;
    }

    public listShards(): ShardInfo[] {
        return this.getShardIds().map((shardId) => ({
            shardId,
            status: this.shards.get(shardId)!.getStatus(),
        }));
    }

    public getShardCount(): number {
        return this.shardCount;
    }

    public setShardCount(shardCount: number): void {
        if (!Number.isInteger(shardCount) || shardCount < 1) {
            throw new Error('shardCount must be an integer >= 1');
        }
        this.shardCount = shardCount;
    }

    public async resolveGateway(): Promise<void> {
        if (this.gatewayResolved && !this.fetchGatewayBot) return;
        if (this.fetchGatewayBot) {
            const info = await this.fetchGatewayBot();
            this.gatewayUrl = info.url;
            this.maxConcurrency = info.sessionStartLimit.maxConcurrency;
            this.identifyQueue.setMaxConcurrency(this.maxConcurrency);
            this.emit('debug', 'gateway bot info resolved', {
                url: info.url,
                recommendedShards: info.shards,
                maxConcurrency: this.maxConcurrency,
                remaining: info.sessionStartLimit.remaining,
            });
        } else {
            const info = await defaultFetchGatewayBot(this.token);
            this.gatewayUrl = info.url;
            this.maxConcurrency = info.sessionStartLimit.maxConcurrency;
            this.identifyQueue.setMaxConcurrency(this.maxConcurrency);
            this.emit('debug', 'gateway bot info resolved (default fetch)', {
                url: info.url,
                maxConcurrency: this.maxConcurrency,
            });
        }
        this.gatewayResolved = true;
    }

    public async addShard(shardId: number): Promise<void> {
        await this.withLock(async () => {
            await this.ensureGateway();
            if (this.shards.has(shardId)) {
                const existing = this.shards.get(shardId)!;
                if (existing.getStatus() === 'ready') return;
                await existing.connect();
                return;
            }
            if (shardId < 0 || shardId >= this.shardCount) {
                throw new Error(
                    `shardId ${shardId} out of range for shardCount ${this.shardCount}`,
                );
            }
            const shard = this.createShard(shardId);
            this.shards.set(shardId, shard);
            await shard.connect();
        });
    }

    public async removeShard(shardId: number, options?: { clearSession?: boolean }): Promise<void> {
        await this.withLock(async () => {
            const shard = this.shards.get(shardId);
            if (!shard) return;
            this.shards.delete(shardId);
            await shard.destroy({ clearSession: options?.clearSession ?? true });
        });
    }

    public async setShards(shardIds: readonly number[]): Promise<void> {
        await this.withLock(async () => {
            await this.ensureGateway();
            const next = [...new Set(shardIds)].sort((a, b) => a - b);
            for (const id of next) {
                if (id < 0 || id >= this.shardCount) {
                    throw new Error(
                        `shardId ${id} out of range for shardCount ${this.shardCount}`,
                    );
                }
            }
            const current = new Set(this.shards.keys());
            const nextSet = new Set(next);

            const toRemove = [...current].filter((id) => !nextSet.has(id));
            const toAdd = next.filter((id) => !current.has(id));

            for (const id of toRemove) {
                const shard = this.shards.get(id);
                this.shards.delete(id);
                if (shard) {
                    await shard.destroy({ clearSession: true });
                }
            }

            for (const id of toAdd) {
                const shard = this.createShard(id);
                this.shards.set(id, shard);
                await shard.connect();
            }
        });
    }

    public async destroy(): Promise<void> {
        await this.withLock(async () => {
            const ids = [...this.shards.keys()];
            for (const id of ids) {
                const shard = this.shards.get(id);
                this.shards.delete(id);
                if (shard) await shard.destroy({ clearSession: false });
            }
        });
    }

    private createShard(shardId: number): GatewayShard {
        const shard = new GatewayShard({
            shardId,
            shardCount: this.shardCount,
            token: this.token,
            intents: this.intents,
            gatewayUrl: this.gatewayUrl,
            largeThreshold: this.largeThreshold,
            properties: this.properties,
            presence: this.presence,
            sessionStore: this.sessionStore,
            identifyQueue: this.identifyQueue,
            autoReconnect: this.autoReconnect,
        });

        shard.on('dispatch', (event: string, data: unknown, sequence: number) => {
            this.emit('dispatch', shardId, event, data, sequence);
        });
        shard.on('ready', (data: ReadyPayload) => {
            this.emit('shardReady', shardId, data);
        });
        shard.on('resumed', () => {
            this.emit('shardResumed', shardId);
        });
        shard.on(
            'disconnect',
            (code: number, reason: string, resumable: boolean) => {
                this.emit('shardDisconnect', shardId, code, reason, resumable);
            },
        );
        shard.on('error', (error: Error) => {
            this.emit('shardError', shardId, error);
        });
        shard.on('reconnecting', (attempt: number) => {
            this.emit('shardReconnecting', shardId, attempt);
        });
        shard.on('debug', (message: string, extra?: Record<string, unknown>) => {
            this.emit('debug', message, extra);
        });

        return shard;
    }

    private async ensureGateway(): Promise<void> {
        if (!this.gatewayResolved) {
            await this.resolveGateway();
        }
    }

    private async withLock(fn: () => Promise<void>): Promise<void> {
        const run = this.applyLock.then(fn, fn);
        this.applyLock = run.then(
            () => undefined,
            () => undefined,
        );
        await run;
    }
}

async function defaultFetchGatewayBot(token: string): Promise<GatewayBotInfo> {
    const res = await fetch('https://discord.com/api/v10/gateway/bot', {
        headers: {
            Authorization: `Bot ${token}`,
        },
    });
    if (!res.ok) {
        throw new Error(`GET /gateway/bot failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as {
        url: string;
        shards: number;
        session_start_limit: {
            total: number;
            remaining: number;
            reset_after: number;
            max_concurrency: number;
        };
    };
    return {
        url: body.url,
        shards: body.shards,
        sessionStartLimit: {
            total: body.session_start_limit.total,
            remaining: body.session_start_limit.remaining,
            resetAfter: body.session_start_limit.reset_after,
            maxConcurrency: body.session_start_limit.max_concurrency,
        },
    };
}
