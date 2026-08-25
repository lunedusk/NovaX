import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { type VerifiedToken } from '#core/manager/token.js';
import { applyGateway, requireAuthedBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded } from '../lib/http.js';
import { BOT_OWNER_BIT } from '../lib/bits.js';

type Authed = DashRequest & { dashSession?: VerifiedToken };

export default class CoreAdminRoute extends BaseRoute {
    public readonly basePath = '/api/core';

    protected register(): void {
        applyGateway(this.heart, this.router);
        const g = this.heart;

        this.router.post(
            '/restart',
            ...requireAuthedBit(g, BOT_OWNER_BIT),
            this.asyncHandler(guarded(g, this.restart.bind(this)))
        );
    }

    private async restart(req: Authed, res: Response): Promise<void> {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'No reason provided';
        this.heart.log.warn(`Restart via REST by ${req.dashSession!.payload.userId}: ${reason}`);

        ok(res, { ok: true, message: 'Restart scheduled.' }, 202);

        setTimeout(() => process.exit(0), 1000);
    }
}
