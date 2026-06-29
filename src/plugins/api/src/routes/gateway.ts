import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import type GatewayManager from '../handlers/manager.js';

/**
 * @openapi
 * /api/openapi.json:
 *   get:
 *     tags: [Gateway]
 *     summary: OpenAPI specification
 *     operationId: getOpenApiSpec
 *     security: []
 *     responses:
 *       '200':
 *         description: OpenAPI 3.1 JSON document
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
export default class GatewayMetaRoute extends BaseRoute {

    public readonly basePath = '/api';

    private get gateway(): GatewayManager | undefined {
        return this.heart.system.handler.$get('api', 'manager') as GatewayManager | undefined;
    }

    protected register(): void {
        this.gateway?.applyMiddleware(this.router);

        this.router.get('/openapi.json', this.asyncHandler(this.handleOpenApi.bind(this)));
    }

    private async handleOpenApi(req: Request, res: Response): Promise<void> {
        const forwarded = req.headers['x-forwarded-proto'];
        const protocol  = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.protocol;
        const host      = req.headers['host'] ?? 'localhost';

        const spec = this.gateway?.buildOpenApiSpec(`${protocol}://${host}`);

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.status(200).json(spec);
    }
}
