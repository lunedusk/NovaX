import { getLogger } from '#core/utils/logger.js';
import type { GatewayBotInfo } from '../types.js';

const log = getLogger('CrossHost:GatewayInfo');

interface GatewayBotApiResponse {
    url?: string;
    shards?: number;
    session_start_limit?: {
        total?: number;
        remaining?: number;
        reset_after?: number;
        max_concurrency?: number;
    };
}

export async function fetchGatewayBot(token: string): Promise<GatewayBotInfo> {
    const res = await fetch('https://discord.com/api/v10/gateway/bot', {
        method: 'GET',
        headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`GET /gateway/bot failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as GatewayBotApiResponse;
    const maxConcurrency = data.session_start_limit?.max_concurrency ?? 1;
    const shards = typeof data.shards === 'number' && data.shards > 0 ? data.shards : 1;
    const info: GatewayBotInfo = {
        url: typeof data.url === 'string' ? data.url : 'wss://gateway.discord.gg',
        shards,
        maxConcurrency,
        sessionStartLimit: {
            total: data.session_start_limit?.total ?? 1000,
            remaining: data.session_start_limit?.remaining ?? 1000,
            resetAfter: data.session_start_limit?.reset_after ?? 0,
            maxConcurrency,
        },
    };
    log.info('Gateway bot info resolved', {
        shards: info.shards,
        maxConcurrency: info.maxConcurrency,
        sessionRemaining: info.sessionStartLimit.remaining,
    });
    return info;
}
