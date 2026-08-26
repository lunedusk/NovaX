import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireAuthedBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, parsePagination, paginated } from '../lib/http.js';
import { cmdCounterCollection, auditCollection } from '../lib/db.js';
import { BITS } from '../lib/bits.js';

interface CounterDoc {
    date: string;
    pluginId: string;
    commandName: string;
    count: number;
}

export default class AdminAnalyticsRoute extends BaseRoute {
    public readonly basePath = '/api/dash/admin';

    protected register(): void {
        applyGateway(this.heart, this.router);
        const analytics = requireAuthedBit(this.heart, BITS.BOT_ANALYTICS_VIEW);
        const logs = requireAuthedBit(this.heart, BITS.BOT_LOGS_VIEW);

        this.router.get('/analytics/overview', ...analytics, this.asyncHandler(guarded(this.heart, this.overview.bind(this))));
        this.router.get('/analytics/commands', ...analytics, this.asyncHandler(guarded(this.heart, this.commands.bind(this))));
        this.router.get('/analytics/plugins', ...analytics, this.asyncHandler(guarded(this.heart, this.plugins.bind(this))));
        this.router.get('/logs', ...logs, this.asyncHandler(guarded(this.heart, this.logs.bind(this))));
    }

    private dateRange(req: DashRequest): { from: string; to: string } {
        const to = typeof req.query.to === 'string' ? req.query.to : new Date().toISOString().slice(0, 10);
        const fromDefault = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
        const from = typeof req.query.from === 'string' ? req.query.from : fromDefault;
        if (from > to) throw new HttpError(400, 'bad_request', '`from` must be before `to`.');
        return { from, to };
    }

    private async allCounters(): Promise<CounterDoc[]> {
        const col = await cmdCounterCollection(this.heart);
        const out: CounterDoc[] = [];
        for await (const doc of col.scan('cmd_', 'cmd_\uffff')) out.push(doc as unknown as CounterDoc);
        return out;
    }

    private async overview(req: DashRequest, res: Response): Promise<void> {
        const { from, to } = this.dateRange(req);
        const counters = (await this.allCounters()).filter((c) => c.date >= from && c.date <= to);
        const totalCommands = counters.reduce((sum, c) => sum + c.count, 0);
        const uniquePlugins = new Set(counters.map((c) => c.pluginId)).size;

        ok(res, {
            from,
            to,
            totalCommands,
            uniquePluginsUsed: uniquePlugins,
            servers: this.heart.client.guilds.cache.size,
            users: this.heart.client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0),
            uptimeMs: this.heart.client.uptime ?? 0,
        });
    }

    private async commands(req: DashRequest, res: Response): Promise<void> {
        const { from, to } = this.dateRange(req);
        const counters = (await this.allCounters()).filter((c) => c.date >= from && c.date <= to);

        const byDate = new Map<string, number>();
        for (const c of counters) byDate.set(c.date, (byDate.get(c.date) ?? 0) + c.count);

        const series = [...byDate.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([date, count]) => ({ date, count }));

        ok(res, { from, to, series });
    }

    private async plugins(req: DashRequest, res: Response): Promise<void> {
        const { from, to } = this.dateRange(req);
        const counters = (await this.allCounters()).filter((c) => c.date >= from && c.date <= to);

        const byPlugin = new Map<string, number>();
        for (const c of counters) byPlugin.set(c.pluginId, (byPlugin.get(c.pluginId) ?? 0) + c.count);

        const breakdown = [...byPlugin.entries()]
            .sort(([, a], [, b]) => b - a)
            .map(([pluginId, count]) => ({ pluginId, count }));

        ok(res, { from, to, breakdown });
    }

    private async logs(req: DashRequest, res: Response): Promise<void> {
        const pagination = this.heart.assets.config.get('pagination') as { defaultLimit: number; maxLimit: number };
        const p = parsePagination(req, pagination);
        const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : undefined;
        const action = typeof req.query.action === 'string' ? req.query.action : undefined;

        const col = await auditCollection(this.heart);
        const all: Record<string, unknown>[] = [];
        for await (const doc of col.scan('log_', 'log_\uffff')) {
            if (guildId && doc.guildId !== guildId) continue;
            if (action && doc.action !== action) continue;
            all.push(doc);
        }
        all.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));

        const page = all.slice(p.offset, p.offset + p.limit);
        ok(res, paginated(page, all.length, p));
    }
}
