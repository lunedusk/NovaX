import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface MachineTokenClaims {
    readonly mid: string;
    readonly iat: number;
    readonly exp: number;
    readonly jti: string;
}

function b64url(buf: Buffer): string {
    return buf.toString('base64url');
}

function fromB64url(s: string): Buffer {
    return Buffer.from(s, 'base64url');
}

export function issueMachineToken(
    secret: string,
    machineId: string,
    ttlSec: number,
): { token: string; expiresAt: number; claims: MachineTokenClaims } {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + Math.max(60, ttlSec);
    const jti = randomBytes(16).toString('hex');
    const claims: MachineTokenClaims = { mid: machineId, iat, exp, jti };
    const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
    const sig = b64url(createHmac('sha256', secret).update(payload).digest());
    return { token: `${payload}.${sig}`, expiresAt: exp * 1000, claims };
}

export function verifyMachineToken(
    secret: string,
    token: string,
    expectedMachineId?: string,
): MachineTokenClaims | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    if (!payload || !sig) return null;

    const expectedSig = b64url(createHmac('sha256', secret).update(payload).digest());
    try {
        const a = fromB64url(sig);
        const b = fromB64url(expectedSig);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } catch {
        return null;
    }

    let claims: MachineTokenClaims;
    try {
        const raw = JSON.parse(fromB64url(payload).toString('utf8')) as unknown;
        if (
            typeof raw !== 'object' ||
            raw === null ||
            typeof (raw as MachineTokenClaims).mid !== 'string' ||
            typeof (raw as MachineTokenClaims).iat !== 'number' ||
            typeof (raw as MachineTokenClaims).exp !== 'number' ||
            typeof (raw as MachineTokenClaims).jti !== 'string'
        ) {
            return null;
        }
        claims = raw as MachineTokenClaims;
    } catch {
        return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now) return null;
    if (expectedMachineId !== undefined && claims.mid !== expectedMachineId) return null;
    return claims;
}
