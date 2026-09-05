import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireAuthedBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError } from '../lib/http.js';
import { writeAudit } from '../lib/db.js';
import {
    listAllPlugins,
    getPluginInfo,
    assertKnownPlugin,
    rawLoadedPlugin,
    enablePlugins,
    disablePlugins,
    reloadPlugins,
    type BatchResult,
} from '../lib/pluginLifecycle.js';
import {
    getPluginConfig,
    getPluginConfigRedacted,
    setPluginConfig,
    resetPluginConfig,
    getPluginConfigSchema,
    listPluginLocales,
    getPluginLocale,
    updatePluginLocale,
    createPluginLocale,
    deletePluginLocale,
} from '../lib/pluginConfig.js';
import { BITS } from '../lib/bits.js';

type PluginParams = { pluginId: string };
type PluginLocaleParams = { pluginId: string; locale: string };

export default class AdminPluginsRoute extends BaseRoute {
    public readonly basePath = '/api/dash/plugins';

    
    /**
     * @openapi
     * /api/dash/plugins/registry:
     *   get:
     *     tags: [DashboardPlugins]
     *     summary: Plugin registry
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Registry }
     * /api/dash/plugins:
     *   get:
     *     tags: [DashboardPlugins]
     *     summary: List plugins
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Plugins }
     * /api/dash/plugins/{pluginId}:
     *   get:
     *     tags: [DashboardPlugins]
     *     summary: Plugin detail
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: pluginId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200': { description: Plugin }
     * /api/dash/plugins/{pluginId}/enable:
     *   post:
     *     tags: [DashboardPlugins]
     *     summary: Enable plugin
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Enabled }
     * /api/dash/plugins/{pluginId}/disable:
     *   post:
     *     tags: [DashboardPlugins]
     *     summary: Disable plugin
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Disabled }
     * /api/dash/plugins/{pluginId}/reload:
     *   post:
     *     tags: [DashboardPlugins]
     *     summary: Reload plugin
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Reloaded }
     * /api/dash/plugins/{pluginId}/config:
     *   get:
     *     tags: [DashboardPlugins]
     *     summary: Plugin config
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Config }
     *   put:
     *     tags: [DashboardPlugins]
     *     summary: Update plugin config
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Saved }
     * /api/dash/plugins/{pluginId}/config/redacted:
     *   get:
     *     tags: [DashboardPlugins]
     *     summary: Redacted config
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Config }
     * /api/dash/plugins/{pluginId}/config/schema:
     *   get:
     *     tags: [DashboardPlugins]
     *     summary: Config schema
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Schema }
     * /api/dash/plugins/{pluginId}/config/reset:
     *   post:
     *     tags: [DashboardPlugins]
     *     summary: Reset config
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Reset }
     * /api/dash/plugins/{pluginId}/lang:
     *   get:
     *     tags: [DashboardPlugins]
     *     summary: List locales
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Locales }
     * /api/dash/plugins/{pluginId}/lang/{locale}:
     *   get:
     *     tags: [DashboardPlugins]
     *     summary: Get locale strings
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Lang }
     *   put:
     *     tags: [DashboardPlugins]
     *     summary: Replace locale
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Saved }
     *   post:
     *     tags: [DashboardPlugins]
     *     summary: Merge locale
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Merged }
     *   delete:
     *     tags: [DashboardPlugins]
     *     summary: Delete locale
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Deleted }
     */

protected register(): void {
        applyGateway(this.heart, this.router);

        const view = requireAuthedBit(this.heart, BITS.BOT_PLUGINS_VIEW);
        const manage = requireAuthedBit(this.heart, BITS.BOT_PLUGINS_MANAGE);
        const reloadBit = requireAuthedBit(this.heart, BITS.BOT_PLUGINS_RELOAD);

        this.router.get('/registry', ...view, this.asyncHandler(guarded(this.heart, this.registry.bind(this))));
        this.router.get('/', ...view, this.asyncHandler(guarded(this.heart, this.list.bind(this))));
        this.router.get('/:pluginId', ...view, this.asyncHandler(guarded(this.heart, this.detail.bind(this))));

        this.router.post('/:pluginId/enable', ...manage, this.asyncHandler(guarded(this.heart, this.enable.bind(this))));
        this.router.post('/:pluginId/disable', ...manage, this.asyncHandler(guarded(this.heart, this.disable.bind(this))));
        this.router.post('/:pluginId/reload', ...reloadBit, this.asyncHandler(guarded(this.heart, this.reload.bind(this))));

        this.router.get('/:pluginId/config', ...view, this.asyncHandler(guarded(this.heart, this.getConfig.bind(this))));
        this.router.get('/:pluginId/config/redacted', ...view, this.asyncHandler(guarded(this.heart, this.getConfigRedacted.bind(this))));
        this.router.get('/:pluginId/config/schema', ...view, this.asyncHandler(guarded(this.heart, this.getConfigSchema.bind(this))));
        this.router.put('/:pluginId/config', ...manage, this.asyncHandler(guarded(this.heart, this.putConfig.bind(this))));
        this.router.post('/:pluginId/config/reset', ...manage, this.asyncHandler(guarded(this.heart, this.resetConfig.bind(this))));

        this.router.get('/:pluginId/lang', ...view, this.asyncHandler(guarded(this.heart, this.listLocales.bind(this))));
        this.router.get('/:pluginId/lang/:locale', ...view, this.asyncHandler(guarded(this.heart, this.getLocale.bind(this))));
        this.router.put('/:pluginId/lang/:locale', ...manage, this.asyncHandler(guarded(this.heart, this.putLocale.bind(this))));
        this.router.post('/:pluginId/lang/:locale', ...manage, this.asyncHandler(guarded(this.heart, this.createLocale.bind(this))));
        this.router.delete('/:pluginId/lang/:locale', ...manage, this.asyncHandler(guarded(this.heart, this.deleteLocale.bind(this))));
    }

    private targetIds(req: DashRequest<PluginParams>): string[] {
        const extra = Array.isArray(req.body?.pluginIds) ? (req.body.pluginIds as unknown[]).map(String) : [];
        return [req.params.pluginId, ...extra];
    }

    private async auditBatch(req: DashRequest, action: string, result: BatchResult): Promise<void> {
        for (const pluginId of result.success) {
            await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action, target: pluginId });
        }
        for (const pluginId of result.failed) {
            await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: `${action}.failed`, target: pluginId });
        }
    }

    private async list(_req: DashRequest, res: Response): Promise<void> {
        ok(res, await listAllPlugins());
    }

    private async detail(req: DashRequest<PluginParams>, res: Response): Promise<void> {
        const info = await getPluginInfo(req.params.pluginId);
        if (!info) throw new HttpError(404, 'not_found', `Plugin ${req.params.pluginId} was not found on disk or in the loaded registry.`);
        const raw = rawLoadedPlugin(req.params.pluginId);
        ok(res, { ...info, manifest: raw?.manifest ?? info });
    }

    private async registry(_req: DashRequest, res: Response): Promise<void> {
        const all = await listAllPlugins();
        const entries = all.map((p) => {
            const raw = rawLoadedPlugin(p.id);
            const manifest = raw?.manifest as { dashboard?: { pageBundleUrl?: string } } | undefined;
            return { pluginId: p.id, manifest: raw?.manifest ?? p, pageBundleUrl: manifest?.dashboard?.pageBundleUrl ?? null };
        });
        ok(res, entries);
    }

    private async enable(req: DashRequest<PluginParams>, res: Response): Promise<void> {
        const result = await enablePlugins(this.heart, this.targetIds(req));
        await this.auditBatch(req, 'plugin.enable', result);
        ok(res, result);
    }

    private async disable(req: DashRequest<PluginParams>, res: Response): Promise<void> {
        const result = await disablePlugins(this.targetIds(req));
        await this.auditBatch(req, 'plugin.disable', result);
        ok(res, result);
    }

    private async reload(req: DashRequest<PluginParams>, res: Response): Promise<void> {
        const result = await reloadPlugins(this.heart, this.targetIds(req));
        await this.auditBatch(req, 'plugin.reload', result);
        ok(res, result);
    }

    private async getConfig(req: DashRequest<PluginParams>, res: Response): Promise<void> {
        await assertKnownPlugin(req.params.pluginId);
        ok(res, await getPluginConfig(req.params.pluginId));
    }

    private async getConfigRedacted(req: DashRequest<PluginParams>, res: Response): Promise<void> {
        await assertKnownPlugin(req.params.pluginId);
        ok(res, await getPluginConfigRedacted(req.params.pluginId));
    }

    private async getConfigSchema(req: DashRequest<PluginParams>, res: Response): Promise<void> {
        await assertKnownPlugin(req.params.pluginId);
        ok(res, await getPluginConfigSchema(req.params.pluginId));
    }

    private async putConfig(req: DashRequest<PluginParams>, res: Response): Promise<void> {
        await assertKnownPlugin(req.params.pluginId);
        if (!req.body || typeof req.body !== 'object') {
            throw new HttpError(400, 'bad_request', 'Request body must be a JSON config object.');
        }
        const updated = await setPluginConfig(req.params.pluginId, req.body);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'plugin.config.save', target: req.params.pluginId });
        ok(res, updated);
    }

    private async resetConfig(req: DashRequest<PluginParams>, res: Response): Promise<void> {
        await assertKnownPlugin(req.params.pluginId);
        const reset = await resetPluginConfig(req.params.pluginId);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'plugin.config.reset', target: req.params.pluginId });
        ok(res, reset);
    }

    private async listLocales(req: DashRequest<PluginParams>, res: Response): Promise<void> {
        await assertKnownPlugin(req.params.pluginId);
        ok(res, await listPluginLocales(req.params.pluginId));
    }

    private async getLocale(req: DashRequest<PluginLocaleParams>, res: Response): Promise<void> {
        await assertKnownPlugin(req.params.pluginId);
        const content = await getPluginLocale(req.params.pluginId, req.params.locale);
        if (!content) throw new HttpError(404, 'not_found', `Locale ${req.params.locale} not found for ${req.params.pluginId}.`);
        ok(res, content);
    }

    private async putLocale(req: DashRequest<PluginLocaleParams>, res: Response): Promise<void> {
        await assertKnownPlugin(req.params.pluginId);
        if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'bad_request', 'Body must be a locale JSON object.');
        await updatePluginLocale(req.params.pluginId, req.params.locale, req.body);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'plugin.lang.save', target: `${req.params.pluginId}:${req.params.locale}` });
        ok(res, { saved: true });
    }

    private async createLocale(req: DashRequest<PluginLocaleParams>, res: Response): Promise<void> {
        await assertKnownPlugin(req.params.pluginId);
        if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'bad_request', 'Body must be a locale JSON object.');
        await createPluginLocale(req.params.pluginId, req.params.locale, req.body);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'plugin.lang.create', target: `${req.params.pluginId}:${req.params.locale}` });
        ok(res, { created: true }, 201);
    }

    private async deleteLocale(req: DashRequest<PluginLocaleParams>, res: Response): Promise<void> {
        await assertKnownPlugin(req.params.pluginId);
        await deletePluginLocale(req.params.pluginId, req.params.locale);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'plugin.lang.delete', target: `${req.params.pluginId}:${req.params.locale}` });
        ok(res, { deleted: true });
    }
}
