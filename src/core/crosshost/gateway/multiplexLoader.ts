import { secrets } from '#core/helpers/secretManager.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CrossHost:MultiplexLoader');

export type GatewayMultiplexModule = typeof import('@lunedusk/gateway-multiplex');

let cached: GatewayMultiplexModule | null = null;

export function isCrossHostGatewayContext(): boolean {
    return secrets.getBoolean('CROSS_HOST', false);
}

export async function loadGatewayMultiplex(): Promise<GatewayMultiplexModule> {
    if (!isCrossHostGatewayContext()) {
        throw new Error(
            '@lunedusk/gateway-multiplex may only be loaded when CROSS_HOST is enabled; standalone and classic isSharded use stock discord.js',
        );
    }
    if (cached) return cached;
    try {
        cached = await import('@lunedusk/gateway-multiplex');
        log.info('gateway-multiplex module loaded (Cross-Host only)');
        return cached;
    } catch (err) {
        log.error('Failed to load @lunedusk/gateway-multiplex', err);
        throw err;
    }
}
