import type { TokenManager } from '#core/manager/token.js';
import { getHeartTokenManager } from './holders.js';

export type TokenDomain = {
    readonly manager: () => TokenManager;
};

export const tokenDomain: TokenDomain = Object.freeze({
    manager(): TokenManager {
        const m = getHeartTokenManager();
        if (!m) {
            throw new Error(
                'Token manager is not initialized. Token APIs are available after token subsystem boot.',
            );
        }
        return m;
    },
});
