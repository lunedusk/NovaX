import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded } from '../lib/http.js';
import { buildRegistrySnapshot } from '../lib/dashRegistry.js';
import { secrets } from '#core/helpers/secretManager.js';
import { BOT_OWNER_BIT } from '../lib/bits.js';
import type { Bit } from '#core/manager/token.js';
import { tryTokens } from '../lib/tokens.js';

function envOwnerIds(): string[] {
    const raw = secrets.getOptional('BotOwnerIds', '') ?? '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export default class DashRegistryRoute extends BaseRoute {
    public readonly basePath = '/api/dash';

    protected register(): void {
        applyGateway(this.heart, this.router);
        this.router.get(
            '/registry',
            requireSession(this.heart),
            this.asyncHandler(guarded(this.heart, this.snapshot.bind(this))),
        );
    }

    private async snapshot(req: DashRequest, res: Response): Promise<void> {
        const session = req.dashSession!;
        const t = tryTokens(this.heart);
        const bitList = session.payload.bits ?? [];
        const bits = new Set<string>(bitList.map(String));
        if (t?.hasBit(session, BOT_OWNER_BIT as Bit)) {
            bits.add(BOT_OWNER_BIT);
        }
        const userId = session.payload.userId;
        const isEnvOwner = envOwnerIds().includes(userId);
        const data = await buildRegistrySnapshot({ bits, userId, isEnvOwner });
        ok(res, data);
    }
}
