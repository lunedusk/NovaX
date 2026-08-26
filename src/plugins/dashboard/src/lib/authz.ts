import { type Request, type Response, type NextFunction, type Router } from 'express';
import { type IHeart } from '#core/heart/index.js';
import { TokenError, type VerifiedToken, type Bit } from '#core/manager/token.js';
import { err } from './http.js';
import { BOT_OWNER_BIT } from './bits.js';
import { tryTokens } from './tokens.js';
import type GatewayManager from '../../../api/src/handlers/manager.js';

export interface DashRequest<P = Record<string, string>> extends Request<P> {
    dashSession?: VerifiedToken;
}

function gateway(heart: IHeart): GatewayManager | undefined {
    return heart.system.handler.$get('api', 'manager') as GatewayManager | undefined;
}

export function applyGateway(heart: IHeart, router: Router): void {
    const api = gateway(heart);
    if (!api) {
        heart.log.warn('api plugin handler unavailable — dashboard routes are running WITHOUT gateway auth.');
        return;
    }
    api.applyMiddleware(router);
}

export function requireSession(heart: IHeart) {
    return async (req: DashRequest, res: Response, next: NextFunction): Promise<void> => {
        const t = tryTokens(heart);
        if (!t) {
            err(res, 500, 'internal', 'Token handler unavailable.');
            return;
        }

        const raw = req.header('X-Dash-Session');
        if (!raw) {
            err(res, 401, 'unauthorized', heart.assets.lang.get(heart.id, 'errors.unauthorized'));
            return;
        }

        try {
            req.dashSession = await t.verify(raw);
            next();
        } catch (e) {
            if (e instanceof TokenError) {
                if (e.tokenCode === 'TOKEN_REVOKED' || e.code === 'TOKEN.TOKEN_REVOKED') {
                    err(res, 401, 'rotation_detected', heart.assets.lang.get(heart.id, 'errors.rotationDetected'));
                    return;
                }
                if (e.tokenCode === 'TOKEN_EXPIRED' || e.code === 'TOKEN.TOKEN_EXPIRED') {
                    err(res, 401, 'session_expired', heart.assets.lang.get(heart.id, 'errors.sessionExpired'));
                    return;
                }
                err(res, 401, e.code, e.userMessage);
                return;
            }
            err(res, 401, 'session_expired', heart.assets.lang.get(heart.id, 'errors.sessionExpired'));
        }
    };
}

export function requireBit(heart: IHeart, bit: string) {
    return (req: DashRequest, res: Response, next: NextFunction): void => {
        const t = tryTokens(heart);
        const verified = req.dashSession;
        if (!t || !verified) {
            err(res, 401, 'unauthorized', heart.assets.lang.get(heart.id, 'errors.unauthorized'));
            return;
        }
        if (t.hasBit(verified, BOT_OWNER_BIT as Bit) || t.hasBit(verified, bit as Bit)) {
            next();
            return;
        }
        err(res, 403, 'forbidden', heart.assets.lang.get(heart.id, 'errors.forbidden'));
    };
}

export function requireAuthedBit(heart: IHeart, bit: string) {
    return [requireSession(heart), requireBit(heart, bit)];
}

export function requireGuildBit(heart: IHeart, bit: string, crossServerBit?: string) {
    return [
        requireSession(heart),
        (req: DashRequest, res: Response, next: NextFunction): void => {
            const t = tryTokens(heart);
            const verified = req.dashSession;
            const guildId = req.params.guildId;
            if (!t || !verified) {
                err(res, 401, 'unauthorized', heart.assets.lang.get(heart.id, 'errors.unauthorized'));
                return;
            }
            if (t.hasBit(verified, BOT_OWNER_BIT as Bit)) return next();
            if (crossServerBit && t.hasBit(verified, crossServerBit as Bit)) return next();
            if (verified.payload.guildId && verified.payload.guildId !== guildId) {
                err(res, 403, 'forbidden', heart.assets.lang.get(heart.id, 'errors.forbidden'));
                return;
            }
            if (t.hasBit(verified, bit as Bit)) return next();
            err(res, 403, 'forbidden', heart.assets.lang.get(heart.id, 'errors.forbidden'));
        },
    ];
}
