import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import type GatewayManager from '../../../api/src/handlers/manager.js';
import type { AuditRecord } from '#core/audit/types.js';

function serialize(entry: AuditRecord): Record<string, unknown> {
    return {
        id: entry.id,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        target: entry.target,
        outcome: entry.outcome,
        reason: entry.reason,
        meta: entry.meta,
        createdAt: entry.createdAt,
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
 * /api/audit:
 *   get:
 *     tags: [Audit]
 *     summary: List audit entries
 *     description: Requires bit bot.audit.view. Query filters - actorId, actorType, action, outcome, from, to, limit (default 50, max 200).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: actorId
 *         schema: { type: string }
 *       - in: query
 *         name: actorType
 *         schema: { type: string }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *       - in: query
 *         name: outcome
 *         schema: { type: string, enum: [success, fail] }
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
 *         description: Audit entry list
 * /api/audit/{id}:
 *   get:
 *     tags: [Audit]
 *     summary: Get one audit entry by id
 *     description: Requires bit bot.audit.view.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Audit entry
 *       '404':
 *         description: Not found
 */

export default class AuditApiRoute extends BaseRoute {
    public readonly basePath = '/api/audit';

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
        const entries = await this.heart.system.audit.list({
            actorId: queryString(req, 'actorId') ?? queryString(req, 'actor'),
            actorType: queryString(req, 'actorType'),
            action: queryString(req, 'action'),
            outcome: queryString(req, 'outcome'),
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
        const entry = await this.heart.system.audit.getById(id);
        if (!entry) {
            res.status(404).json({ error: 'NOT_FOUND', message: 'Audit entry not found.' });
            return;
        }
        res.json({ entry: serialize(entry) });
    }
}
