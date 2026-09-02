export interface SessionInfo {
    readonly sessionId: string;
    readonly sequence: number;
    readonly resumeUrl: string;
}

export interface GatewayBotInfo {
    readonly url: string;
    readonly shards: number;
    readonly sessionStartLimit: {
        readonly total: number;
        readonly remaining: number;
        readonly resetAfter: number;
        readonly maxConcurrency: number;
    };
}

export interface IdentifyProperties {
    readonly os: string;
    readonly browser: string;
    readonly device: string;
}

export interface PresenceUpdateData {
    readonly since: number | null;
    readonly activities: readonly unknown[];
    readonly status: 'online' | 'dnd' | 'idle' | 'invisible' | 'offline';
    readonly afk: boolean;
}

export interface GatewayMultiplexOptions {
    readonly token: string;
    readonly intents: number;
    readonly shardCount: number;
    readonly maxConcurrency?: number;
    readonly gatewayUrl?: string;
    readonly largeThreshold?: number;
    readonly compress?: boolean;
    readonly properties?: IdentifyProperties;
    readonly presence?: PresenceUpdateData;
    readonly autoReconnect?: boolean;
    readonly sessionStore?: SessionStore;
    readonly fetchGatewayBot?: () => Promise<GatewayBotInfo>;
}

export interface SessionStore {
    get(shardId: number): Promise<SessionInfo | null> | SessionInfo | null;
    set(shardId: number, info: SessionInfo): Promise<void> | void;
    delete(shardId: number): Promise<void> | void;
}

export type ShardStatus =
    | 'idle'
    | 'connecting'
    | 'identifying'
    | 'resuming'
    | 'ready'
    | 'reconnecting'
    | 'disconnected'
    | 'destroyed';

export interface GatewayPayload {
    op: number;
    d?: unknown;
    s?: number | null;
    t?: string | null;
}

export interface HelloPayload {
    heartbeat_interval: number;
}

export interface ReadyPayload {
    v: number;
    user: { id: string; username: string; discriminator: string; bot?: boolean };
    guilds: readonly unknown[];
    session_id: string;
    resume_gateway_url: string;
    shard?: [number, number];
    application?: { id: string; flags: number };
}

export interface MultiplexEvents {
    dispatch: [shardId: number, event: string, data: unknown, sequence: number];
    shardReady: [shardId: number, data: ReadyPayload];
    shardResumed: [shardId: number];
    shardDisconnect: [shardId: number, code: number, reason: string, resumable: boolean];
    shardError: [shardId: number, error: Error];
    shardReconnecting: [shardId: number, attempt: number];
    debug: [message: string, extra?: Record<string, unknown>];
}
