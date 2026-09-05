import { secrets } from '#core/helpers/secretManager.js';
import { permissionsManager } from '#core/manager/permissions.js';
import { BOT_OWNER_BIT } from './bits.js';

export function envOwnerIds(): string[] {
    const raw = secrets.getOptional('BotOwnerIds', '') ?? '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function isEnvOwnerUser(userId: string): boolean {
    return envOwnerIds().includes(userId);
}

export async function isBotOwnerUser(userId: string): Promise<boolean> {
    if (isEnvOwnerUser(userId)) return true;
    if (!permissionsManager) return false;
    try {
        return await permissionsManager.hasBit(userId, BOT_OWNER_BIT);
    } catch {
        return false;
    }
}

export function isBotOwnerFromBits(
    userId: string,
    bits: ReadonlySet<string> | readonly string[] | null | undefined,
): boolean {
    if (isEnvOwnerUser(userId)) return true;
    if (!bits) return false;
    if ('has' in bits) return bits.has(BOT_OWNER_BIT);
    return bits.includes(BOT_OWNER_BIT);
}