export const BROKER_LIMITS = {
    maxMessagesPerWindow: 60,
    windowMs: 10_000,
    maxPayloadBytes: 65_536,
    strikesToDispose: 5,
    strikeDecayMs: 60_000,
    nonceTtlMs: 3_600_000,
} as const;

interface SurfaceBucket {
    timestamps: number[];
    strikes: number;
    lastStrikeAt: number;
    disposed: boolean;
}

const buckets = new Map<string, SurfaceBucket>();

function key(sessionJti: string, pluginId: string, surfaceId: string): string {
    return `${sessionJti}:${pluginId}:${surfaceId}`;
}

function bucket(sessionJti: string, pluginId: string, surfaceId: string): SurfaceBucket {
    const k = key(sessionJti, pluginId, surfaceId);
    let b = buckets.get(k);
    if (!b) {
        b = { timestamps: [], strikes: 0, lastStrikeAt: 0, disposed: false };
        buckets.set(k, b);
    }
    return b;
}

export function isSurfaceDisposed(sessionJti: string, pluginId: string, surfaceId: string): boolean {
    return bucket(sessionJti, pluginId, surfaceId).disposed;
}

export function recordBrokerMessage(
    sessionJti: string,
    pluginId: string,
    surfaceId: string,
    payloadBytes: number,
    now = Date.now(),
): { ok: true } | { ok: false; code: 'rate_limited' | 'payload_too_large' | 'disposed'; strike: number } {
    const b = bucket(sessionJti, pluginId, surfaceId);
    if (b.disposed) return { ok: false, code: 'disposed', strike: b.strikes };

    if (now - b.lastStrikeAt > BROKER_LIMITS.strikeDecayMs) {
        b.strikes = 0;
    }

    if (payloadBytes > BROKER_LIMITS.maxPayloadBytes) {
        b.strikes += 1;
        b.lastStrikeAt = now;
        if (b.strikes >= BROKER_LIMITS.strikesToDispose) b.disposed = true;
        return { ok: false, code: 'payload_too_large', strike: b.strikes };
    }

    b.timestamps = b.timestamps.filter((t) => now - t < BROKER_LIMITS.windowMs);
    if (b.timestamps.length >= BROKER_LIMITS.maxMessagesPerWindow) {
        b.strikes += 1;
        b.lastStrikeAt = now;
        if (b.strikes >= BROKER_LIMITS.strikesToDispose) b.disposed = true;
        return { ok: false, code: 'rate_limited', strike: b.strikes };
    }
    b.timestamps.push(now);
    return { ok: true };
}

export function disposeSurface(sessionJti: string, pluginId: string, surfaceId: string): void {
    const b = bucket(sessionJti, pluginId, surfaceId);
    b.disposed = true;
}

export function resetBrokerLimitsForTests(): void {
    buckets.clear();
}
