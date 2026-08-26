import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireAuthedBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded } from '../lib/http.js';
import { BITS } from '../lib/bits.js';
import { inspectCommands, inspectEvents, inspectRoutes } from '../lib/registryInspect.js';

export default class AdminRegistryRoute extends BaseRoute {
    public readonly basePath = '/api/dash/admin/registry';

    protected register(): void {
        applyGateway(this.heart, this.router);
        const view = requireAuthedBit(this.heart, BITS.BOT_PLUGINS_VIEW);

        this.router.get(
            '/commands',
            ...view,
            this.asyncHandler(guarded(this.heart, this.commands.bind(this))),
        );
        this.router.get(
            '/events',
            ...view,
            this.asyncHandler(guarded(this.heart, this.events.bind(this))),
        );
        this.router.get(
            '/routes',
            ...view,
            this.asyncHandler(guarded(this.heart, this.routes.bind(this))),
        );
    }

    private async commands(_req: DashRequest, res: Response): Promise<void> {
        ok(res, inspectCommands());
    }

    private async events(_req: DashRequest, res: Response): Promise<void> {
        ok(res, inspectEvents());
    }

    private async routes(_req: DashRequest, res: Response): Promise<void> {
        ok(res, inspectRoutes());
    }
}
