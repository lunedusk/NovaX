import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import { permissionsManager } from '#core/manager/permissions.js';
import { permissionCache } from '#core/manager/permissionCache.js';
import { PermissionError } from '#core/types/permissions.js';
import type GatewayManager from '../../../api/src/handlers/manager.js';
import { actorFromGateway } from '#core/audit/actor.js';

export default class PermissionsApiRoute extends BaseRoute {

    public readonly basePath = '/api/permissions';

    private get api(): GatewayManager | undefined {
        return this.heart.system.handler.$get('api', 'manager') as GatewayManager | undefined;
    }

    private get mgr() { return permissionsManager!; }

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

        this.router.get('/resolve/:userId', this.asyncHandler(this.resolveUser.bind(this)));
        this.router.get('/check/:userId/:bit', this.asyncHandler(this.checkBit.bind(this)));
        this.router.post('/check-batch', this.asyncHandler(this.checkBatch.bind(this)));
        this.router.get('/bits', this.asyncHandler(this.listBits.bind(this)));
        this.router.post('/bits', this.asyncHandler(this.registerBit.bind(this)));
        this.router.get('/roles/bot', this.asyncHandler(this.listBotRoles.bind(this)));
        this.router.post('/roles/bot', this.asyncHandler(this.createBotRole.bind(this)));
        this.router.put('/roles/bot/:roleId', this.asyncHandler(this.updateBotRole.bind(this)));
        this.router.delete('/roles/bot/:roleId', this.asyncHandler(this.deleteBotRole.bind(this)));
        this.router.post('/roles/bot/:roleId/assign', this.asyncHandler(this.assignBotRole.bind(this)));
        this.router.post('/roles/bot/:roleId/revoke', this.asyncHandler(this.revokeBotRole.bind(this)));
        this.router.get('/roles/server/:guildId', this.asyncHandler(this.listServerRoles.bind(this)));
        this.router.post('/roles/server/:guildId', this.asyncHandler(this.createServerRole.bind(this)));
        this.router.put('/roles/server/:guildId/:roleId', this.asyncHandler(this.updateServerRole.bind(this)));
        this.router.delete('/roles/server/:guildId/:roleId', this.asyncHandler(this.deleteServerRole.bind(this)));
        this.router.post('/roles/server/:guildId/:roleId/assign', this.asyncHandler(this.assignServerRole.bind(this)));
        this.router.post('/roles/server/:guildId/:roleId/revoke', this.asyncHandler(this.revokeServerRole.bind(this)));
        this.router.post('/cache/clear', this.asyncHandler(this.clearCache.bind(this)));
        this.router.post('/cache/invalidate', this.asyncHandler(this.invalidateCache.bind(this)));
    }

    /**
     * @openapi
     * /api/permissions/resolve/{userId}:
     *   get:
     *     tags: [Permissions]
     *     summary: Resolve a user's effective permission bits
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: userId
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: guildId
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Resolved permission data
     */
    private async resolveUser(req: Request, res: Response): Promise<void> {
        const userId = this.param(req, 'userId');
        const guildId = this.query(req, 'guildId');
        const resolved = await this.mgr.cachedResolve(userId, guildId);
        res.json({ userId, guildId: guildId ?? null, botOwner: resolved.botOwner, bits: [...resolved.bits], resolvedAt: resolved.resolvedAt });
    }

    /**
     * @openapi
     * /api/permissions/check/{userId}/{bit}:
     *   get:
     *     tags: [Permissions]
     *     summary: Check if a user has a specific permission bit
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: userId
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: bit
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: guildId
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Bit check result
     */
    private async checkBit(req: Request, res: Response): Promise<void> {
        const userId = this.param(req, 'userId');
        const bit = this.param(req, 'bit');
        const guildId = this.query(req, 'guildId');
        const has = await this.mgr.hasBit(userId, bit, guildId);
        res.json({ userId, bit, guildId: guildId ?? null, has });
    }

    /**
     * @openapi
     * /api/permissions/check-batch:
     *   post:
     *     tags: [Permissions]
     *     summary: Batch-check permission bits for a user
     *     description: Requires bit bot.permissions.view.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [userId, bits]
     *             properties:
     *               userId: { type: string }
     *               bits: { type: array, items: { type: string } }
     *               mode: { type: string, enum: [all, any] }
     *               guildId: { type: string }
     *     responses:
     *       '200':
     *         description: Batch check result
     */
    private async checkBatch(req: Request, res: Response): Promise<void> {
        const body = req.body as { userId?: unknown; bits?: unknown; mode?: unknown; guildId?: unknown };
        const userId = typeof body.userId === 'string' ? body.userId : '';
        const mode = body.mode === 'any' ? 'any' : 'all';
        const guildId = typeof body.guildId === 'string' ? body.guildId : undefined;
        const bitsRaw = body.bits;
        if (!userId || !Array.isArray(bitsRaw) || bitsRaw.length === 0) {
            res.status(400).json({ error: 'userId and non-empty bits array are required' });
            return;
        }
        const bits = bitsRaw.map(String);
        const allowed =
            mode === 'any'
                ? await this.mgr.hasAnyBit(userId, bits, guildId)
                : await this.mgr.hasAllBits(userId, bits, guildId);
        res.json({ userId, guildId: guildId ?? null, mode, bits, allowed });
    }

    private async listBits(req: Request, res: Response): Promise<void> {
        const scope = this.query(req, 'scope') as 'bot' | 'server' | 'plugin' | undefined;
        res.json({ bits: await this.mgr.listBits(scope) });
    }

    /**
     * @openapi
     * /api/permissions/bits:
     *   post:
     *     tags: [Permissions]
     *     summary: Register a custom permission bit
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [bit, description]
     *             properties:
     *               bit: { type: string }
     *               description: { type: string }
     *               pluginId: { type: string }
     *     responses:
     *       '201':
     *         description: Bit registered
     */
    private async registerBit(req: Request, res: Response): Promise<void> {
        const { bit, description, pluginId } = req.body;
        if (!bit || !description) { res.status(400).json({ error: 'Missing required fields: bit, description' }); return; }
        const actor = actorFromGateway(res);
        try {
            await this.mgr.registerBit(String(bit), String(description), pluginId ? String(pluginId) : undefined);
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.bit.register',
                target: String(bit),
                outcome: 'success',
                meta: { pluginId: pluginId ? String(pluginId) : null },
            });
            res.status(201).json({ bit, registered: true });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.bit.register',
                target: String(bit),
                outcome: 'fail',
                reason: 'error',
            });
            throw err;
        }
    }

    /**
     * @openapi
     * /api/permissions/roles/bot:
     *   get:
     *     tags: [Permissions]
     *     summary: List all bot-wide roles
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       '200':
     *         description: Array of bot-wide roles
     */
    private async listBotRoles(_req: Request, res: Response): Promise<void> {
        res.json({ roles: await this.mgr.listBotRoles() });
    }

    /**
     * @openapi
     * /api/permissions/roles/bot:
     *   post:
     *     tags: [Permissions]
     *     summary: Create a bot-wide role
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [name, color, bits, createdBy]
     *             properties:
     *               name: { type: string }
     *               color: { type: string }
     *               bits: { type: array, items: { type: string } }
     *               createdBy: { type: string }
     *     responses:
     *       '201':
     *         description: Role created
     */
    private async createBotRole(req: Request, res: Response): Promise<void> {
        const actor = actorFromGateway(res);
        try {
            const role = await this.mgr.createBotRole(req.body, null);
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.create',
                target: String((role as { id?: string }).id ?? 'bot-role'),
                outcome: 'success',
                meta: { name: typeof req.body?.name === 'string' ? req.body.name : null },
            });
            res.status(201).json({ role });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.create',
                target: 'bot-role',
                outcome: 'fail',
                reason: err instanceof PermissionError ? err.code : 'error',
            });
            if (err instanceof PermissionError) { res.status(err.statusCode ?? 400).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/permissions/roles/bot/{roleId}:
     *   put:
     *     tags: [Permissions]
     *     summary: Update a bot-wide role
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Role updated
     */
    private async updateBotRole(req: Request, res: Response): Promise<void> {
        const actor = actorFromGateway(res);
        const roleId = this.param(req, 'roleId');
        try {
            const role = await this.mgr.updateBotRole(roleId, req.body, null);
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.update',
                target: roleId,
                outcome: 'success',
            });
            res.json({ role });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.update',
                target: roleId,
                outcome: 'fail',
                reason: err instanceof PermissionError ? err.code : 'error',
            });
            if (err instanceof PermissionError) { res.status(err.statusCode ?? 404).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/permissions/roles/bot/{roleId}:
     *   delete:
     *     tags: [Permissions]
     *     summary: Delete a bot-wide role
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Role deleted
     */
    private async deleteBotRole(req: Request, res: Response): Promise<void> {
        await this.mgr.deleteBotRole(this.param(req, 'roleId'), null);
        res.json({ deleted: true });
    }

    /**
     * @openapi
     * /api/permissions/roles/bot/{roleId}/assign:
     *   post:
     *     tags: [Permissions]
     *     summary: Assign users to a bot-wide role
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [userIds]
     *             properties:
     *               userIds: { type: array, items: { type: string } }
     *     responses:
     *       '200':
     *         description: Users assigned
     */
    private async assignBotRole(req: Request, res: Response): Promise<void> {
        const { userIds } = req.body;
        if (!Array.isArray(userIds) || userIds.length === 0) { res.status(400).json({ error: 'userIds must be a non-empty array' }); return; }
        const actor = actorFromGateway(res);
        const roleId = this.param(req, 'roleId');
        try {
            await this.mgr.assignBotRole(roleId, userIds, null);
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.assign',
                target: roleId,
                outcome: 'success',
                meta: { count: userIds.length },
            });
            res.json({ assigned: true, roleId, userIds });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.assign',
                target: roleId,
                outcome: 'fail',
                reason: err instanceof PermissionError ? err.code : 'error',
            });
            if (err instanceof PermissionError) { res.status(err.statusCode ?? 404).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/permissions/roles/bot/{roleId}/revoke:
     *   post:
     *     tags: [Permissions]
     *     summary: Revoke users from a bot-wide role
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [userIds]
     *             properties:
     *               userIds: { type: array, items: { type: string } }
     *     responses:
     *       '200':
     *         description: Users revoked
     */
    private async revokeBotRole(req: Request, res: Response): Promise<void> {
        const { userIds } = req.body;
        if (!Array.isArray(userIds) || userIds.length === 0) { res.status(400).json({ error: 'userIds must be a non-empty array' }); return; }
        const actor = actorFromGateway(res);
        const roleId = this.param(req, 'roleId');
        try {
            await this.mgr.revokeBotRole(roleId, userIds, null);
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.revoke',
                target: roleId,
                outcome: 'success',
                meta: { count: userIds.length },
            });
            res.json({ revoked: true, roleId, userIds });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.revoke',
                target: roleId,
                outcome: 'fail',
                reason: err instanceof PermissionError ? err.code : 'error',
            });
            if (err instanceof PermissionError) { res.status(err.statusCode ?? 404).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/permissions/roles/server/{guildId}:
     *   get:
     *     tags: [Permissions]
     *     summary: List server roles for a guild
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: guildId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Array of server roles
     */
    private async listServerRoles(req: Request, res: Response): Promise<void> {
        res.json({ roles: await this.mgr.listServerRoles(this.param(req, 'guildId')) });
    }

    /**
     * @openapi
     * /api/permissions/roles/server/{guildId}:
     *   post:
     *     tags: [Permissions]
     *     summary: Create a server role
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: guildId
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [name, color, bits, createdBy]
     *             properties:
     *               name: { type: string }
     *               color: { type: string }
     *               bits: { type: array, items: { type: string } }
     *               createdBy: { type: string }
     *     responses:
     *       '201':
     *         description: Server role created
     */
    private async createServerRole(req: Request, res: Response): Promise<void> {
        const actor = actorFromGateway(res);
        const guildId = this.param(req, 'guildId');
        try {
            const role = await this.mgr.createServerRole(guildId, req.body);
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.create',
                target: String((role as { id?: string }).id ?? 'server-role'),
                outcome: 'success',
                meta: { guildId },
            });
            res.status(201).json({ role });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.create',
                target: 'server-role',
                outcome: 'fail',
                reason: err instanceof PermissionError ? err.code : 'error',
                meta: { guildId },
            });
            if (err instanceof PermissionError) { res.status(err.statusCode ?? 400).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/permissions/roles/server/{guildId}/{roleId}:
     *   put:
     *     tags: [Permissions]
     *     summary: Update a server role
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: guildId
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Server role updated
     */
    private async updateServerRole(req: Request, res: Response): Promise<void> {
        const actor = actorFromGateway(res);
        const guildId = this.param(req, 'guildId');
        const roleId = this.param(req, 'roleId');
        try {
            const role = await this.mgr.updateServerRole(guildId, roleId, req.body);
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.update',
                target: roleId,
                outcome: 'success',
                meta: { guildId },
            });
            res.json({ role });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.update',
                target: roleId,
                outcome: 'fail',
                reason: err instanceof PermissionError ? err.code : 'error',
                meta: { guildId },
            });
            if (err instanceof PermissionError) { res.status(err.statusCode ?? 404).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/permissions/roles/server/{guildId}/{roleId}:
     *   delete:
     *     tags: [Permissions]
     *     summary: Delete a server role
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: guildId
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Server role deleted
     */
    private async deleteServerRole(req: Request, res: Response): Promise<void> {
        const actor = actorFromGateway(res);
        const guildId = this.param(req, 'guildId');
        const roleId = this.param(req, 'roleId');
        try {
            await this.mgr.deleteServerRole(guildId, roleId);
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.delete',
                target: roleId,
                outcome: 'success',
                meta: { guildId },
            });
            res.json({ deleted: true });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.delete',
                target: roleId,
                outcome: 'fail',
                reason: 'error',
                meta: { guildId },
            });
            throw err;
        }
    }

    /**
     * @openapi
     * /api/permissions/roles/server/{guildId}/{roleId}/assign:
     *   post:
     *     tags: [Permissions]
     *     summary: Assign users to a server role
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: guildId
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [userIds]
     *             properties:
     *               userIds: { type: array, items: { type: string } }
     *     responses:
     *       '200':
     *         description: Users assigned
     */
    private async assignServerRole(req: Request, res: Response): Promise<void> {
        const { userIds } = req.body;
        if (!Array.isArray(userIds) || userIds.length === 0) { res.status(400).json({ error: 'userIds must be a non-empty array' }); return; }
        const actor = actorFromGateway(res);
        const guildId = this.param(req, 'guildId');
        const roleId = this.param(req, 'roleId');
        try {
            await this.mgr.assignServerRole(guildId, roleId, userIds);
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.assign',
                target: roleId,
                outcome: 'success',
                meta: { guildId, count: userIds.length },
            });
            res.json({ assigned: true, roleId, userIds });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.assign',
                target: roleId,
                outcome: 'fail',
                reason: err instanceof PermissionError ? err.code : 'error',
                meta: { guildId },
            });
            if (err instanceof PermissionError) { res.status(err.statusCode ?? 404).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/permissions/roles/server/{guildId}/{roleId}/revoke:
     *   post:
     *     tags: [Permissions]
     *     summary: Revoke users from a server role
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: guildId
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [userIds]
     *             properties:
     *               userIds: { type: array, items: { type: string } }
     *     responses:
     *       '200':
     *         description: Users revoked
     */
    private async revokeServerRole(req: Request, res: Response): Promise<void> {
        const { userIds } = req.body;
        if (!Array.isArray(userIds) || userIds.length === 0) { res.status(400).json({ error: 'userIds must be a non-empty array' }); return; }
        const actor = actorFromGateway(res);
        const guildId = this.param(req, 'guildId');
        const roleId = this.param(req, 'roleId');
        try {
            await this.mgr.revokeServerRole(guildId, roleId, userIds);
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.revoke',
                target: roleId,
                outcome: 'success',
                meta: { guildId, count: userIds.length },
            });
            res.json({ revoked: true, roleId, userIds });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'perm.role.revoke',
                target: roleId,
                outcome: 'fail',
                reason: err instanceof PermissionError ? err.code : 'error',
                meta: { guildId },
            });
            if (err instanceof PermissionError) { res.status(err.statusCode ?? 404).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/permissions/cache/clear:
     *   post:
     *     tags: [Permissions]
     *     summary: Flush entire permission cache
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       '200':
     *         description: Cache cleared
     */
    private async clearCache(_req: Request, res: Response): Promise<void> {
        if (permissionCache) { await permissionCache.clearAll(); }
        res.json({ cleared: true });
    }

    /**
     * @openapi
     * /api/permissions/cache/invalidate:
     *   post:
     *     tags: [Permissions]
     *     summary: Invalidate cache for a specific user or guild
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               userId: { type: string }
     *               guildId: { type: string }
     *     responses:
     *       '200':
     *         description: Cache invalidated
     */
    private async invalidateCache(req: Request, res: Response): Promise<void> {
        const userId: string | undefined = req.body.userId ? String(req.body.userId) : undefined;
        const guildId: string | undefined = req.body.guildId ? String(req.body.guildId) : undefined;
        if (!userId && !guildId) { res.status(400).json({ error: 'Provide userId, guildId, or both' }); return; }
        if (guildId && !userId) { await this.mgr.invalidateGuildCache(guildId); }
        else { await this.mgr.invalidateUserCache(userId!, guildId); }
        res.json({ invalidated: true, userId: userId ?? null, guildId: guildId ?? null });
    }
}
