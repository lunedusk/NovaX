import { type Request, type Response } from 'express';
import { type IHeart } from '#core/heart/index.js';

export function ok(res: Response, data: unknown, status = 200): void {
    res.status(status).json({ ok: true, data });
}

export function err(
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: unknown,
): void {
    res.status(status).json({
        ok: false,
        error: { code, message, ...(details !== undefined ? { details } : {}) },
    });
}

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly details?: unknown,
    ) {
        super(message);
    }
}

export function sendHttpError(res: Response, e: unknown, heart: IHeart): void {
    if (e instanceof HttpError) {
        err(res, e.status, e.code, e.message, e.details);
        return;
    }
    heart.log.error(`Unhandled dashboard route error: ${(e as Error)?.stack ?? e}`);
    err(res, 500, 'internal', heart.assets.lang.get(heart.id, 'errors.internal'));
}

export interface Pagination {
    page: number;
    limit: number;
    offset: number;
}

export function parsePagination(
    req: Request,
    defaults: { defaultLimit: number; maxLimit: number },
): Pagination {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit ?? defaults.defaultLimit), 10);
    const limit = Math.min(
        defaults.maxLimit,
        Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaults.defaultLimit),
    );
    return { page, limit, offset: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, p: Pagination) {
    return {
        items,
        pagination: {
            page: p.page,
            limit: p.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / p.limit)),
        },
    };
}

export function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
}

export function guarded<Req extends Request>(heart: IHeart, fn: (req: Req, res: Response) => Promise<void>) {
    return async (req: Req, res: Response): Promise<void> => {
        try {
            await fn(req, res);
        } catch (e) {
            sendHttpError(res, e, heart);
        }
    };
}

export function requireBody<T extends Record<string, unknown>>(
    body: unknown,
    requiredKeys: (keyof T)[],
): T {
    if (!body || typeof body !== 'object') {
        throw new HttpError(400, 'bad_request', 'Request body must be a JSON object.');
    }
    const missing = requiredKeys.filter((k) => (body as Record<string, unknown>)[k as string] === undefined);
    if (missing.length > 0) {
        throw new HttpError(400, 'bad_request', `Missing required field(s): ${missing.join(', ')}`);
    }
    return body as T;
}
