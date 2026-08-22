import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import { guildGate } from '#core/manager/guildGate.js';
import type GatewayManager from '../../../api/src/handlers/manager.js';
import { actorFromGateway } from '#core/audit/actor.js';

/**
 * @openapi
 * /api/gates/guilds:
 *   get:
 *     tags: [Gates]
 *     summary: List blocked guilds
 *     description: Requires bit bot.gates.view.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Blocked guild list
 * /api/gates/guilds/{guildId}/block:
 *   post:
 *     tags: [Gates]
 *     summary: Block a guild
 *     description: Requires bit bot.gates.manage.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: guildId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Guild blocked
 * /api/gates/guilds/{guildId}/unblock:
 *   post:
 *     tags: [Gates]
 *     summary: Unblock a guild
 *     description: Requires bit bot.gates.manage.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: guildId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Guild unblocked
 * /api/gates/plugins:
 *   get:
 *     tags: [Gates]
 *     summary: List blocked plugins
 *     description: Requires bit bot.gates.view.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Blocked plugin list
 * /api/gates/plugins/{pluginId}/block:
 *   post:
 *     tags: [Gates]
 *     summary: Block a plugin (optionally guild-scoped via body)
 *     description: Requires bit bot.gates.manage.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pluginId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Plugin blocked
 * /api/gates/plugins/{pluginId}/unblock:
 *   post:
 *     tags: [Gates]
 *     summary: Unblock a plugin
 *     description: Requires bit bot.gates.manage.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pluginId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Plugin unblocked
 */

export default class GatesApiRoute extends BaseRoute {
    public readonly basePath = '/api/gates';

    private get api(): GatewayManager | undefined {
        return this.heart.system.handler.$get('api', 'manager') as GatewayManager | undefined;
    }

    private param(req: Request, key: string): string {
        const val = req.params[key];
        return Array.isArray(val) ? val[0] : String(val ?? '');
    }

    private query(req: Request, key: string): string | undefined {
        const val = req.query[key];
        return typeof val === 'string' ? val : undefined;
    }

    protected register(): void {
        this.api?.applyMiddleware(this.router);

        this.router.get('/guilds', this.asyncHandler(this.listGuilds.bind(this)));
        this.router.post('/guilds/:guildId/block', this.asyncHandler(this.blockGuild.bind(this)));
        this.router.post('/guilds/:guildId/unblock', this.asyncHandler(this.unblockGuild.bind(this)));
        this.router.get('/plugins', this.asyncHandler(this.listPlugins.bind(this)));
        this.router.post('/plugins/:pluginId/block', this.asyncHandler(this.blockPlugin.bind(this)));
        this.router.post('/plugins/:pluginId/unblock', this.asyncHandler(this.unblockPlugin.bind(this)));
    }

    private async listGuilds(_req: Request, res: Response): Promise<void> {
        if (!guildGate.isReady()) {
            res.status(503).json({ error: 'GUILD_GATE_UNAVAILABLE', message: 'Guild gate is not initialized.' });
            return;
        }
        const rows = await guildGate.listBlockedGuilds();
        res.json({ guilds: rows });
    }

    private async blockGuild(req: Request, res: Response): Promise<void> {
        if (!guildGate.isReady()) {
            res.status(503).json({ error: 'GUILD_GATE_UNAVAILABLE', message: 'Guild gate is not initialized.' });
            return;
        }
        const guildId = this.param(req, 'guildId');
        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }
        const body = req.body as { reason?: unknown; updatedBy?: unknown };
        const reason = typeof body.reason === 'string' ? body.reason : null;
        const updatedBy = typeof body.updatedBy === 'string' ? body.updatedBy : undefined;
        const actor = actorFromGateway(res);
        try {
            await guildGate.blockGuild(guildId, updatedBy, reason);
            void this.heart.system.audit.record({
                ...actor,
                action: 'gate.guild.block',
                target: guildId,
                outcome: 'success',
                reason: reason ?? undefined,
            });
            res.json({ guildId, blocked: true, reason });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'gate.guild.block',
                target: guildId,
                outcome: 'fail',
                reason: 'error',
            });
            throw err;
        }
    }

    private async unblockGuild(req: Request, res: Response): Promise<void> {
        if (!guildGate.isReady()) {
            res.status(503).json({ error: 'GUILD_GATE_UNAVAILABLE', message: 'Guild gate is not initialized.' });
            return;
        }
        const guildId = this.param(req, 'guildId');
        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }
        const actor = actorFromGateway(res);
        try {
            const ok = await guildGate.unblockGuild(guildId);
            void this.heart.system.audit.record({
                ...actor,
                action: 'gate.guild.unblock',
                target: guildId,
                outcome: ok ? 'success' : 'fail',
                reason: ok ? undefined : 'not_blocked',
            });
            res.json({ guildId, unblocked: ok });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'gate.guild.unblock',
                target: guildId,
                outcome: 'fail',
                reason: 'error',
            });
            throw err;
        }
    }

    private async listPlugins(req: Request, res: Response): Promise<void> {
        if (!guildGate.isReady()) {
            res.status(503).json({ error: 'GUILD_GATE_UNAVAILABLE', message: 'Guild gate is not initialized.' });
            return;
        }
        const guildId = this.query(req, 'guildId');
        const rows = await guildGate.listBlockedPlugins(guildId);
        res.json({ plugins: rows, guildId: guildId ?? null });
    }

    private async blockPlugin(req: Request, res: Response): Promise<void> {
        if (!guildGate.isReady()) {
            res.status(503).json({ error: 'GUILD_GATE_UNAVAILABLE', message: 'Guild gate is not initialized.' });
            return;
        }
        const pluginId = this.param(req, 'pluginId');
        const body = req.body as { guildId?: unknown; reason?: unknown; updatedBy?: unknown };
        const guildId = typeof body.guildId === 'string' ? body.guildId : '';
        if (!pluginId || !guildId) {
            res.status(400).json({ error: 'pluginId and body.guildId are required' });
            return;
        }
        const reason = typeof body.reason === 'string' ? body.reason : null;
        const updatedBy = typeof body.updatedBy === 'string' ? body.updatedBy : undefined;
        const actor = actorFromGateway(res);
        try {
            await guildGate.blockPlugin(guildId, pluginId, updatedBy, reason);
            void this.heart.system.audit.record({
                ...actor,
                action: 'gate.plugin.block',
                target: pluginId,
                outcome: 'success',
                reason: reason ?? undefined,
                meta: { guildId },
            });
            res.json({ guildId, pluginId, blocked: true, reason });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'gate.plugin.block',
                target: pluginId,
                outcome: 'fail',
                reason: 'error',
                meta: { guildId },
            });
            throw err;
        }
    }

    private async unblockPlugin(req: Request, res: Response): Promise<void> {
        if (!guildGate.isReady()) {
            res.status(503).json({ error: 'GUILD_GATE_UNAVAILABLE', message: 'Guild gate is not initialized.' });
            return;
        }
        const pluginId = this.param(req, 'pluginId');
        const body = req.body as { guildId?: unknown };
        const guildId = typeof body.guildId === 'string' ? body.guildId : '';
        if (!pluginId || !guildId) {
            res.status(400).json({ error: 'pluginId and body.guildId are required' });
            return;
        }
        const actor = actorFromGateway(res);
        try {
            const ok = await guildGate.unblockPlugin(guildId, pluginId);
            void this.heart.system.audit.record({
                ...actor,
                action: 'gate.plugin.unblock',
                target: pluginId,
                outcome: ok ? 'success' : 'fail',
                reason: ok ? undefined : 'not_blocked',
                meta: { guildId },
            });
            res.json({ guildId, pluginId, unblocked: ok });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'gate.plugin.unblock',
                target: pluginId,
                outcome: 'fail',
                reason: 'error',
                meta: { guildId },
            });
            throw err;
        }
    }
}
