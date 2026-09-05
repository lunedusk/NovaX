import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireAuthedAnyBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded } from '../lib/http.js';
import { audit } from '#core/audit/index.js';
import { list as listErrors } from '#core/errors/index.js';
import {
    serializeAuditForExport,
    serializeErrorForExport,
    toCsv,
} from '../lib/exportFormat.js';
import { BITS } from '../lib/bits.js';

function formatParam(req: DashRequest): 'json' | 'csv' {
    const raw = req.query.format;
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v === 'csv') return 'csv';
    return 'json';
}

function queryString(req: DashRequest, key: string): string | undefined {
    const val = req.query[key];
    if (typeof val === 'string' && val.length > 0) return val;
    if (Array.isArray(val) && typeof val[0] === 'string' && val[0].length > 0) return val[0];
    return undefined;
}

function queryNumber(req: DashRequest, key: string): number | undefined {
    const raw = queryString(req, key);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return Math.floor(n);
}

export default class AdminExportsRoute extends BaseRoute {
    public readonly basePath = '/api/dash/admin';

    
    /**
     * @openapi
     * /api/dash/admin/audit/export:
     *   get:
     *     tags: [DashboardAdmin]
     *     summary: Export audit log
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Export body }
     * /api/dash/admin/errors/export:
     *   get:
     *     tags: [DashboardAdmin]
     *     summary: Export error log
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Export body }
     */

protected register(): void {
        applyGateway(this.heart, this.router);
        const auditBit = requireAuthedAnyBit(this.heart, [BITS.BOT_AUDIT_EXPORT, BITS.BOT_AUDIT_VIEW]);
        const errorsBit = requireAuthedAnyBit(this.heart, [BITS.BOT_ERRORS_EXPORT, BITS.BOT_ERRORS_VIEW]);

        this.router.get(
            '/audit/export',
            ...auditBit,
            this.asyncHandler(guarded(this.heart, this.auditExport.bind(this))),
        );
        this.router.get(
            '/errors/export',
            ...errorsBit,
            this.asyncHandler(guarded(this.heart, this.errorsExport.bind(this))),
        );
    }

    private async auditExport(req: DashRequest, res: Response): Promise<void> {
        const format = formatParam(req);
        const limit = Math.min(queryNumber(req, 'limit') ?? 1000, 10_000);
        const entries = await audit.list({
            actorId: queryString(req, 'actorId'),
            actorType: queryString(req, 'actorType'),
            action: queryString(req, 'action'),
            outcome: queryString(req, 'outcome'),
            from: queryNumber(req, 'from'),
            to: queryNumber(req, 'to'),
            limit,
        });
        const rows = entries.map(serializeAuditForExport);
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="audit-export.csv"');
            res.status(200).send(toCsv(rows));
            return;
        }
        ok(res, { items: rows, count: rows.length, format: 'json' });
    }

    private async errorsExport(req: DashRequest, res: Response): Promise<void> {
        const format = formatParam(req);
        const limit = Math.min(queryNumber(req, 'limit') ?? 1000, 10_000);
        const entries = await listErrors({
            code: queryString(req, 'code'),
            category: queryString(req, 'category'),
            severity: queryString(req, 'severity'),
            from: queryNumber(req, 'from'),
            to: queryNumber(req, 'to'),
            limit,
        });
        const rows = entries.map(serializeErrorForExport);
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="errors-export.csv"');
            res.status(200).send(toCsv(rows));
            return;
        }
        ok(res, { items: rows, count: rows.length, format: 'json' });
    }
}
