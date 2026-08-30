import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const CHALLENGE_TTL_MS = 60_000;

export interface ChallengeRecord {
    readonly challengeId: string;
    readonly nonce: string;
    readonly machineId: string;
    readonly expiresAt: number;
}

export function createChallenge(machineId: string): ChallengeRecord {
    const challengeId = randomBytes(16).toString('hex');
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    return { challengeId, nonce, machineId, expiresAt };
}

export function buildManifestHash(
    novaxVersion: string,
    plugins: readonly { id: string; version: string }[],
): string {
    const sorted = [...plugins]
        .map((p) => `${p.id}@${p.version}`)
        .sort((a, b) => a.localeCompare(b));
    const payload = `${novaxVersion}|${sorted.join(',')}`;
    return createHmac('sha256', 'manifest').update(payload).digest('hex');
}

export function computeRegisterHmac(
    secret: string,
    parts: {
        nonce: string;
        machineId: string;
        manifestHash: string;
        novaxVersion: string;
        bootGeneration: string;
    },
): string {
    const material = [
        parts.nonce,
        parts.machineId,
        parts.manifestHash,
        parts.novaxVersion,
        parts.bootGeneration,
    ].join('|');
    return createHmac('sha256', secret).update(material).digest('hex');
}

export function verifyHmacEqual(expectedHex: string, providedHex: string): boolean {
    try {
        const a = Buffer.from(expectedHex, 'hex');
        const b = Buffer.from(providedHex, 'hex');
        if (a.length === 0 || a.length !== b.length) return false;
        return timingSafeEqual(a, b);
    } catch {
        return false;
    }
}
