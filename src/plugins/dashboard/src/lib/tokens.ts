import { type IHeart } from '#core/heart/index.js';
import { HttpError } from './http.js';
import type TokenHandler from '../../../token/src/handlers/manager.js';

export function tokens(heart: IHeart): TokenHandler {
    const handler = heart.system.handler.$get('token', 'manager') as TokenHandler | undefined;
    if (!handler) {
        throw new HttpError(500, 'internal', 'token plugin handler unavailable.');
    }
    return handler;
}

export function tryTokens(heart: IHeart): TokenHandler | undefined {
    return heart.system.handler.$get('token', 'manager') as TokenHandler | undefined;
}
