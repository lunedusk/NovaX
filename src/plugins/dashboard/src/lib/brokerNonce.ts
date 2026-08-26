import { randomBytes } from 'node:crypto';
import { BROKER_LIMITS } from './brokerLimits.js';

export interface FrameBinding {
    nonce: string;
    sessionJti: string;
    userId: string;
    pluginId: string;
    surfaceId: string;
    bound: boolean;
    createdAt: number;
    expiresAt: number;
}

const frames = new Map<string, FrameBinding>();

function prune(now = Date.now()): void {
    for (const [k, v] of frames) {
        if (v.expiresAt <= now) frames.delete(k);
    }
}

export function issueFrameNonce(input: {
    sessionJti: string;
    userId: string;
    pluginId: string;
    surfaceId: string;
}): FrameBinding {
    prune();
    const nonce = randomBytes(24).toString('base64url');
    const now = Date.now();
    const binding: FrameBinding = {
        nonce,
        sessionJti: input.sessionJti,
        userId: input.userId,
        pluginId: input.pluginId,
        surfaceId: input.surfaceId,
        bound: false,
        createdAt: now,
        expiresAt: now + BROKER_LIMITS.nonceTtlMs,
    };
    frames.set(nonce, binding);
    return binding;
}

export function bindFrameOnReady(
    nonce: string,
    claim: { sessionJti: string; pluginId: string; surfaceId: string },
): FrameBinding | null {
    prune();
    const binding = frames.get(nonce);
    if (!binding) return null;
    if (binding.expiresAt <= Date.now()) {
        frames.delete(nonce);
        return null;
    }
    if (
        binding.sessionJti !== claim.sessionJti ||
        binding.pluginId !== claim.pluginId ||
        binding.surfaceId !== claim.surfaceId
    ) {
        return null;
    }
    binding.bound = true;
    return binding;
}

export function getBoundFrame(nonce: string): FrameBinding | null {
    prune();
    const binding = frames.get(nonce);
    if (!binding || !binding.bound || binding.expiresAt <= Date.now()) return null;
    return binding;
}

export function revokeFrame(nonce: string): void {
    frames.delete(nonce);
}

export function resetBrokerNoncesForTests(): void {
    frames.clear();
}
