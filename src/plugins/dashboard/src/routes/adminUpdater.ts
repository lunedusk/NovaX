import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireAuthedBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded } from '../lib/http.js';
import { BOT_OWNER_BIT } from '../lib/bits.js';
import { buildUpdaterStatusDto } from '../lib/updaterStatus.js';

export default class AdminUpdaterRoute extends BaseRoute {
    public readonly basePath = '/api/dash/admin/updater';

    protected register(): void {
        applyGateway(this.heart, this.router);
        const owner = requireAuthedBit(this.heart, BOT_OWNER_BIT);

        this.router.get(
            '/status',
            ...owner,
            this.asyncHandler(guarded(this.heart, this.status.bind(this))),
        );
    }

    private async status(_req: DashRequest, res: Response): Promise<void> {
        ok(res, buildUpdaterStatusDto());
    }
}
