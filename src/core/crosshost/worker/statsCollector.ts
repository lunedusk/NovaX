import {
    GatewayIntentBits,
    type Client,
    Events,
} from 'discord.js';
import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';
import type { WorkerStats } from '../types.js';
import { channelStats } from '../protocol/channels.js';
import { encodeMessage } from '../protocol/codec.js';

const log = getLogger('CrossHost:StatsCollector');

export class StatsCollector {
    private client: Client | null = null;
    private eventCount = 0;
    private commandCount = 0;
    private windowStarted = Date.now();
    private readonly gauges = new Map<string, number>();
    private readonly machineId: string;
    private readonly pub: Redis;
    private readonly channelPrefix: string;
    private readonly intervalMs: number;
    private timer: NodeJS.Timeout | null = null;
    private getShardCount: () => number;

    constructor(opts: {
        machineId: string;
        pub: Redis;
        channelPrefix: string;
        intervalMs: number;
        getShardCount: () => number;
    }) {
        this.machineId = opts.machineId;
        this.pub = opts.pub;
        this.channelPrefix = opts.channelPrefix;
        this.intervalMs = opts.intervalMs;
        this.getShardCount = opts.getShardCount;
    }

    public bindClient(client: Client | null): void {
        if (this.client) {
            this.client.off(Events.Raw, this.onRaw);
            this.client.off(Events.InteractionCreate, this.onInteraction);
        }
        this.client = client;
        if (client) {
            client.on(Events.Raw, this.onRaw);
            client.on(Events.InteractionCreate, this.onInteraction);
        }
    }

    private readonly onRaw = (): void => {
        this.eventCount += 1;
    };

    private readonly onInteraction = (): void => {
        this.commandCount += 1;
    };

    public setGauge(name: string, value: number): void {
        this.gauges.set(name, value);
    }

    public incGauge(name: string, by = 1): void {
        this.gauges.set(name, (this.gauges.get(name) ?? 0) + by);
    }

    public start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            void this.publish().catch((err) => log.warn('Stats publish failed', err));
        }, this.intervalMs);
        this.timer.unref();
        void this.publish();
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.bindClient(null);
    }

    private hasGuildMembersIntent(): boolean {
        if (!this.client) return false;
        const intents = this.client.options.intents;
        if (intents === undefined) return false;
        if (typeof intents === 'number') {
            return (intents & GatewayIntentBits.GuildMembers) === GatewayIntentBits.GuildMembers;
        }
        if (Array.isArray(intents)) {
            return intents.includes(GatewayIntentBits.GuildMembers) || intents.includes('GuildMembers');
        }
        if (typeof intents === 'object' && intents !== null && 'bitfield' in intents) {
            const bitfield = (intents as { bitfield: bigint | number }).bitfield;
            const n = typeof bitfield === 'bigint' ? Number(bitfield) : bitfield;
            return (n & GatewayIntentBits.GuildMembers) === GatewayIntentBits.GuildMembers;
        }
        return false;
    }

    public collect(): WorkerStats {
        const now = Date.now();
        const elapsedSec = Math.max((now - this.windowStarted) / 1000, 0.001);
        const eventRate = this.eventCount / elapsedSec;
        const commandRate = this.commandCount / elapsedSec;
        this.eventCount = 0;
        this.commandCount = 0;
        this.windowStarted = now;

        let guildCount = 0;
        let memberCount: number | null = null;
        if (this.client) {
            guildCount = this.client.guilds.cache.size;
            if (this.hasGuildMembersIntent()) {
                let sum = 0;
                for (const g of this.client.guilds.cache.values()) {
                    sum += g.memberCount;
                }
                memberCount = sum;
            }
        }

        return {
            machineId: this.machineId,
            guildCount,
            memberCount,
            eventRate,
            commandRate,
            shardCount: this.getShardCount(),
            customGauges: Object.fromEntries(this.gauges),
            at: now,
        };
    }

    public async publish(): Promise<WorkerStats> {
        const stats = this.collect();
        await this.pub.publish(
            channelStats(this.channelPrefix),
            encodeMessage(stats).toString('base64'),
        );
        log.debug('Stats published', {
            machineId: stats.machineId,
            guildCount: stats.guildCount,
            memberCount: stats.memberCount,
            eventRate: stats.eventRate,
            commandRate: stats.commandRate,
            shardCount: stats.shardCount,
        });
        return stats;
    }
}
