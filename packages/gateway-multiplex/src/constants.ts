export const GATEWAY_VERSION = 10 as const;

export const enum GatewayOpcode {
    Dispatch = 0,
    Heartbeat = 1,
    Identify = 2,
    PresenceUpdate = 3,
    VoiceStateUpdate = 4,
    Resume = 6,
    Reconnect = 7,
    RequestGuildMembers = 8,
    InvalidSession = 9,
    Hello = 10,
    HeartbeatAck = 11,
}

export const enum GatewayCloseCode {
    UnknownError = 4000,
    UnknownOpcode = 4001,
    DecodeError = 4002,
    NotAuthenticated = 4003,
    AuthenticationFailed = 4004,
    AlreadyAuthenticated = 4005,
    InvalidSeq = 4007,
    RateLimited = 4008,
    SessionTimedOut = 4009,
    InvalidShard = 4010,
    ShardingRequired = 4011,
    InvalidApiVersion = 4012,
    InvalidIntents = 4013,
    DisallowedIntents = 4014,
}

export const RESUMABLE_CLOSE_CODES = new Set<number>([
    GatewayCloseCode.UnknownError,
    GatewayCloseCode.DecodeError,
    GatewayCloseCode.NotAuthenticated,
    GatewayCloseCode.AlreadyAuthenticated,
    GatewayCloseCode.InvalidSeq,
    GatewayCloseCode.RateLimited,
    GatewayCloseCode.SessionTimedOut,
    1001,
    1006,
]);

export const FATAL_CLOSE_CODES = new Set<number>([
    GatewayCloseCode.AuthenticationFailed,
    GatewayCloseCode.InvalidShard,
    GatewayCloseCode.ShardingRequired,
    GatewayCloseCode.InvalidApiVersion,
    GatewayCloseCode.InvalidIntents,
    GatewayCloseCode.DisallowedIntents,
]);

export const DEFAULT_GATEWAY_URL = 'wss://gateway.discord.gg';
export const ENCODING = 'json' as const;
export const IDENTIFY_BUCKET_SPACING_MS = 5_000;
export const DEFAULT_MAX_CONCURRENCY = 1;
export const CONNECT_TIMEOUT_MS = 30_000;
export const READY_TIMEOUT_MS = 60_000;
