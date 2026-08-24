import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import type GatewayManager from '../../../api/src/handlers/manager.js';
import type { ErrorOccurrence } from '#core/errors/types.js';

function serialize(entry: ErrorOccurrence): Record<string, unknown> {
    return {
        id: entry.id,
        code: entry.code,
        category: entry.category,
        severity: entry.severity,
        message: entry.message,
        context: entry.context,
        count: entry.count,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
    };
}

function queryString(req: Request, key: string): string | undefined {
    const val = req.query[key];
    if (typeof val === 'string' && val.length > 0) return val;
    return undefined;
}

function queryNumber(req: Request, key: string): number | undefined {
    const raw = queryString(req, key);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return Math.floor(n);
}

/**
 * @openapi
 * /api/errors:
 *   get:
 *     tags: [Errors]
 *     summary: List coalesced error occurrences
 *     description: Requires bit bot.errors.view. Surfaces count, firstSeen, lastSeen. Query - code, category, severity, from, to, limit (default 50, max 200).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: code
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: severity
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: integer }
 *       - in: query
 *         name: to
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *     responses:
 *       '200':
 *         description: Error occurrence list with coalesce fields
 * /api/errors/{id}:
 *   get:
 *     tags: [Errors]
 *     summary: Get one error occurrence by id
 *     description: Requires bit bot.errors.view.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Error occurrence
 *       '404':
 *         description: Not found
 */

export default class ErrorsApiRoute extends BaseRoute {
    public readonly basePath = '/api/errors';

    private get api(): GatewayManager | undefined {
        return this.heart.system.handler.$get('api', 'manager') as GatewayManager | undefined;
    }

    private param(req: Request, key: string): string {
        const val = req.params[key];
        return Array.isArray(val) ? val[0] : String(val ?? '');
    }

    protected register(): void {
        this.api?.applyMiddleware(this.router);
        this.router.get('/', this.asyncHandler(this.list.bind(this)));
        this.router.get('/:id', this.asyncHandler(this.getById.bind(this)));
    }

    private async list(req: Request, res: Response): Promise<void> {
        const entries = await this.heart.system.errors.list({
            code: queryString(req, 'code'),
            category: queryString(req, 'category'),
            severity: queryString(req, 'severity'),
            from: queryNumber(req, 'from'),
            to: queryNumber(req, 'to'),
            limit: queryNumber(req, 'limit'),
        });
        res.json({ entries: entries.map(serialize), count: entries.length });
    }

    private async getById(req: Request, res: Response): Promise<void> {
        const id = this.param(req, 'id');
        if (!id) {
            res.status(400).json({ error: 'id is required' });
            return;
        }
        const entry = await this.heart.system.errors.getById(id);
        if (!entry) {
            res.status(404).json({ error: 'NOT_FOUND', message: 'Error occurrence not found.' });
            return;
        }
        res.json({ entry: serialize(entry) });
    }
}
