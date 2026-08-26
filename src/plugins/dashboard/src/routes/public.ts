import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import { applyGateway } from '../lib/authz.js';
import { ok, guarded } from '../lib/http.js';
import { dashGet, dashMongo, ensureDashboardAdapter, cmdCounterCollection } from '../lib/db.js';

export default class PublicRoute extends BaseRoute {
    public readonly basePath = '/api/dash/public';

    protected register(): void {
        applyGateway(this.heart, this.router);

        this.router.get('/landing-config', this.asyncHandler(guarded(this.heart, this.landingConfig.bind(this))));
        this.router.get('/stats', this.asyncHandler(guarded(this.heart, this.stats.bind(this))));
        this.router.get('/bot-info', this.asyncHandler(guarded(this.heart, this.botInfo.bind(this))));
    }

    private async landingConfig(_req: Request, res: Response): Promise<void> {
        const db = await ensureDashboardAdapter();
        let row: { config: string; updatedAt: number } | null = null;
        if (db.engine === 'mongo') {
            const doc = await (await dashMongo('dash_landing_config')).findOne({
                $or: [{ id: 'current' }, { _id: 'current' }],
            });
            if (doc) row = { config: String(doc.config ?? '{}'), updatedAt: Number(doc.updatedAt ?? 0) };
        } else {
            row = (await dashGet(`SELECT config, updatedAt FROM dash_landing_config WHERE id = 'current'`)) as {
                config: string;
                updatedAt: number;
            } | null;
        }
        ok(res, {
            config: JSON.parse(row?.config ?? '{}'),
            updatedAt: row?.updatedAt ?? 0,
        });
    }

    private async stats(_req: Request, res: Response): Promise<void> {
        const client = this.heart.client;
        ok(res, {
            servers: client.guilds.cache.size,
            users: client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0),
            uptimeMs: client.uptime ?? 0,
            commandsExecuted: await this.commandsAllTime(),
        });
    }

    private async botInfo(_req: Request, res: Response): Promise<void> {
        const client = this.heart.client;
        ok(res, {
            name: client.user?.username ?? null,
            avatarUrl: client.user?.displayAvatarURL({ size: 256 }) ?? null,
            inviteUrl: client.user
                ? `https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot%20applications.commands`
                : null,
        });
    }

    private async commandsAllTime(): Promise<number> {
        const col = await cmdCounterCollection(this.heart);
        let total = 0;
        for await (const doc of col.scan('', '\uffff')) {
            total += (doc.count as number) ?? 0;
        }
        return total;
    }
}
