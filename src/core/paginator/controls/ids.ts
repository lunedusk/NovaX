import { randomBytes } from 'node:crypto';
import { PAGINATOR_LIMITS } from '../limits/discord.js';
import type { NavAction } from '../types/models.js';

const PREFIX = 'zene:pg:';

export function newSessionId(): string {
    return randomBytes(6).toString('hex');
}

export function encodeNavCustomId(sessionId: string, action: NavAction): string {
    const id = `${PREFIX}${sessionId}:${action}`;
    if (id.length > PAGINATOR_LIMITS.MAX_CUSTOM_ID_LENGTH) {
        throw new Error(`paginator customId exceeds ${PAGINATOR_LIMITS.MAX_CUSTOM_ID_LENGTH}`);
    }
    return id;
}

export function parseNavCustomId(customId: string): { sessionId: string; action: NavAction } | null {
    if (!customId.startsWith(PREFIX)) return null;
    const rest = customId.slice(PREFIX.length);
    const idx = rest.lastIndexOf(':');
    if (idx <= 0) return null;
    const sessionId = rest.slice(0, idx);
    const action = rest.slice(idx + 1) as NavAction;
    if (!['first', 'prev', 'next', 'last', 'close', 'noop'].includes(action)) return null;
    return { sessionId, action };
}
