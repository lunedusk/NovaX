import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import { TokenError } from '#core/manager/token.js';
import type TokenHandler from '../handlers/manager.js';
import type GatewayManager from '../../../api/src/handlers/manager.js';
import { actorFromGateway } from '#core/audit/actor.js';

export default class TokenApiRoute extends BaseRoute {

    public readonly basePath = '/api/tokens';

    private get api(): GatewayManager | undefined {
        return this.heart.system.handler.$get('api', 'manager') as GatewayManager | undefined;
    }

    private get tokens(): TokenHandler | undefined {
        return this.heart.system.handler.$get('token', 'manager') as TokenHandler | undefined;
    }

    private param(req: Request, key: string): string {
        const val = req.params[key];
        return Array.isArray(val) ? val[0] : String(val ?? '');
    }

    private handler(res: Response): TokenHandler | null {
        const h = this.tokens;
        if (!h) { res.status(503).json({ error: 'TOKEN_UNAVAILABLE', message: 'Token handler is not initialized.' }); return null; }
        return h;
    }

    protected register(): void {
        this.api?.applyMiddleware(this.router);

        this.router.post('/issue', this.asyncHandler(this.handleIssue.bind(this)));
        this.router.post('/issue-resolved', this.asyncHandler(this.handleIssueResolved.bind(this)));
        this.router.post('/verify', this.asyncHandler(this.handleVerify.bind(this)));
        this.router.post('/refresh', this.asyncHandler(this.handleRefresh.bind(this)));
        this.router.post('/refresh-resolved', this.asyncHandler(this.handleRefreshResolved.bind(this)));
        this.router.post('/revoke/all', this.asyncHandler(this.handleRevokeAll.bind(this)));
        this.router.post('/revoke/device', this.asyncHandler(this.handleRevokeDevice.bind(this)));
        this.router.get('/devices/:userId', this.asyncHandler(this.handleListDevices.bind(this)));
        this.router.get('/bitsets', this.asyncHandler(this.handleBitSets.bind(this)));
    }

    /**
     * @openapi
     * /api/tokens/issue:
     *   post:
     *     tags: [Tokens]
     *     summary: Issue a token with explicit permission bits
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [userId]
     *             properties:
     *               userId: { type: string }
     *               bits: { type: array, items: { type: string } }
     *               guildId: { type: string }
     *               deviceId: { type: string }
     *               deviceLabel: { type: string }
     *               ttlSeconds: { type: number }
     *     responses:
     *       '201':
     *         description: Token issued
     */
    private async handleIssue(req: Request, res: Response): Promise<void> {
        const h = this.handler(res); if (!h) return;
        const { userId, bits, guildId, deviceId, deviceLabel, ttlSeconds } = req.body;
        if (!userId) { res.status(400).json({ error: 'Missing userId' }); return; }
        const actor = actorFromGateway(res);
        try {
            const token = await h.issue(String(userId), {
                bits,
                guildId: guildId ? String(guildId) : undefined,
                deviceId: deviceId ? String(deviceId) : undefined,
                deviceLabel: deviceLabel ? String(deviceLabel) : undefined,
                ttlSeconds,
            });
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.issue',
                target: String(userId),
                outcome: 'success',
                meta: {
                    guildId: guildId ? String(guildId) : null,
                    deviceId: deviceId ? String(deviceId) : null,
                    bitsCount: Array.isArray(bits) ? bits.length : 0,
                },
            });
            res.status(201).json({ token });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.issue',
                target: String(userId),
                outcome: 'fail',
                reason: err instanceof TokenError ? err.code : 'error',
            });
            if (err instanceof TokenError) { res.status(400).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/tokens/issue-resolved:
     *   post:
     *     tags: [Tokens]
     *     summary: Issue a token with auto-resolved bits from the permission system
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [userId]
     *             properties:
     *               userId: { type: string }
     *               guildId: { type: string }
     *               deviceId: { type: string }
     *               deviceLabel: { type: string }
     *               ttlSeconds: { type: number }
     *     responses:
     *       '201':
     *         description: Token issued with resolved bits
     */
    private async handleIssueResolved(req: Request, res: Response): Promise<void> {
        const h = this.handler(res); if (!h) return;
        const { userId, guildId, deviceId, deviceLabel, ttlSeconds } = req.body;
        if (!userId) { res.status(400).json({ error: 'Missing userId' }); return; }
        const actor = actorFromGateway(res);
        try {
            const token = await h.issueWithResolvedBits(String(userId), guildId ? String(guildId) : undefined, {
                deviceId: deviceId ? String(deviceId) : undefined,
                deviceLabel: deviceLabel ? String(deviceLabel) : undefined,
                ttlSeconds,
            });
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.issue',
                target: String(userId),
                outcome: 'success',
                meta: {
                    guildId: guildId ? String(guildId) : null,
                    deviceId: deviceId ? String(deviceId) : null,
                    code: 'resolved',
                },
            });
            res.status(201).json({ token });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.issue',
                target: String(userId),
                outcome: 'fail',
                reason: err instanceof TokenError ? err.code : 'error',
            });
            if (err instanceof TokenError) { res.status(400).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/tokens/verify:
     *   post:
     *     tags: [Tokens]
     *     summary: Verify and decode a token
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [token]
     *             properties:
     *               token: { type: string }
     *     responses:
     *       '200':
     *         description: Token is valid
     *       '401':
     *         description: Token expired or revoked
     */
    private async handleVerify(req: Request, res: Response): Promise<void> {
        const h = this.handler(res); if (!h) return;
        const { token } = req.body;
        if (!token) { res.status(400).json({ error: 'Missing token' }); return; }
        try {
            const v = await h.verify(String(token));
            res.json({ valid: true, payload: { userId: v.payload.userId, bits: v.payload.bits, guildId: v.payload.guildId ?? null, deviceId: v.payload.deviceId, deviceLabel: v.payload.deviceLabel ?? null, iat: v.payload.iat, exp: v.payload.exp, iss: v.payload.iss, aud: v.payload.aud } });
        } catch (err) {
            if (err instanceof TokenError) { res.status((err.tokenCode === 'TOKEN_EXPIRED' || err.tokenCode === 'TOKEN_REVOKED' || err.code === 'TOKEN.TOKEN_EXPIRED' || err.code === 'TOKEN.TOKEN_REVOKED') ? 401 : 400).json({ valid: false, error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/tokens/refresh:
     *   post:
     *     tags: [Tokens]
     *     summary: Refresh a token keeping existing bits
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [token]
     *             properties:
     *               token: { type: string }
     *     responses:
     *       '200':
     *         description: New token issued
     */
    private async handleRefresh(req: Request, res: Response): Promise<void> {
        const h = this.handler(res); if (!h) return;
        const { token } = req.body;
        if (!token) { res.status(400).json({ error: 'Missing token' }); return; }
        const actor = actorFromGateway(res);
        let subjectId = 'unknown';
        let jti: string | null = null;
        try {
            const verified = await h.verify(String(token));
            subjectId = verified.payload.userId;
            jti = verified.payload.jti;
            const next = await h.refresh(String(token));
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.refresh',
                target: subjectId,
                outcome: 'success',
                meta: { jti },
            });
            res.json({ token: next });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.refresh',
                target: subjectId,
                outcome: 'fail',
                reason: err instanceof TokenError ? err.code : 'error',
                meta: jti ? { jti } : undefined,
            });
            if (err instanceof TokenError) { res.status(401).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/tokens/refresh-resolved:
     *   post:
     *     tags: [Tokens]
     *     summary: Refresh a token with freshly resolved permission bits
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [token]
     *             properties:
     *               token: { type: string }
     *     responses:
     *       '200':
     *         description: New token with updated bits
     */
    private async handleRefreshResolved(req: Request, res: Response): Promise<void> {
        const h = this.handler(res); if (!h) return;
        const { token } = req.body;
        if (!token) { res.status(400).json({ error: 'Missing token' }); return; }
        const actor = actorFromGateway(res);
        let subjectId = 'unknown';
        let jti: string | null = null;
        try {
            const verified = await h.verify(String(token));
            subjectId = verified.payload.userId;
            jti = verified.payload.jti;
            const next = await h.refreshWithResolvedBits(String(token));
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.refresh',
                target: subjectId,
                outcome: 'success',
                meta: { jti, code: 'resolved' },
            });
            res.json({ token: next });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.refresh',
                target: subjectId,
                outcome: 'fail',
                reason: err instanceof TokenError ? err.code : 'error',
                meta: jti ? { jti, code: 'resolved' } : { code: 'resolved' },
            });
            if (err instanceof TokenError) { res.status(401).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/tokens/revoke/all:
     *   post:
     *     tags: [Tokens]
     *     summary: Revoke all tokens for a user
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [userId]
     *             properties:
     *               userId: { type: string }
     *     responses:
     *       '200':
     *         description: All tokens revoked
     */
    private async handleRevokeAll(req: Request, res: Response): Promise<void> {
        const h = this.handler(res); if (!h) return;
        const { userId } = req.body;
        if (!userId) { res.status(400).json({ error: 'Missing userId' }); return; }
        const actor = actorFromGateway(res);
        try {
            const globalVersion = await h.revokeAll(String(userId));
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.revoke_all',
                target: String(userId),
                outcome: 'success',
            });
            res.json({ revoked: true, userId, globalVersion });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.revoke_all',
                target: String(userId),
                outcome: 'fail',
                reason: err instanceof TokenError ? err.code : 'error',
            });
            if (err instanceof TokenError) { res.status(400).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/tokens/revoke/device:
     *   post:
     *     tags: [Tokens]
     *     summary: Revoke tokens for a specific device
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [userId, deviceId]
     *             properties:
     *               userId: { type: string }
     *               deviceId: { type: string }
     *               guildId: { type: string }
     *     responses:
     *       '200':
     *         description: Device tokens revoked
     */
    private async handleRevokeDevice(req: Request, res: Response): Promise<void> {
        const h = this.handler(res); if (!h) return;
        const { userId, deviceId, guildId } = req.body;
        if (!userId || !deviceId) { res.status(400).json({ error: 'Missing userId or deviceId' }); return; }
        const actor = actorFromGateway(res);
        try {
            const deviceVersion = await h.revokeDevice(
                String(userId),
                String(deviceId),
                guildId ? String(guildId) : undefined,
            );
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.revoke_device',
                target: String(userId),
                outcome: 'success',
                meta: {
                    deviceId: String(deviceId),
                    guildId: guildId ? String(guildId) : null,
                },
            });
            res.json({ revoked: true, userId, deviceId, deviceVersion });
        } catch (err) {
            void this.heart.system.audit.record({
                ...actor,
                action: 'token.revoke_device',
                target: String(userId),
                outcome: 'fail',
                reason: err instanceof TokenError ? err.code : 'error',
                meta: { deviceId: String(deviceId) },
            });
            if (err instanceof TokenError) { res.status(400).json({ error: err.code, message: err.userMessage }); return; }
            throw err;
        }
    }

    /**
     * @openapi
     * /api/tokens/devices/{userId}:
     *   get:
     *     tags: [Tokens]
     *     summary: List all registered devices for a user
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: userId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Array of device metadata
     */
    private async handleListDevices(req: Request, res: Response): Promise<void> {
        const h = this.handler(res); if (!h) return;
        const userId = this.param(req, 'userId');
        try { res.json({ userId, devices: await h.listDevices(userId) }); }
        catch (err) { if (err instanceof TokenError) { res.status(400).json({ error: err.code, message: err.userMessage }); return; } throw err; }
    }

    /**
     * @openapi
     * /api/tokens/bitsets:
     *   get:
     *     tags: [Tokens]
     *     summary: Get predefined BitSet constants
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       '200':
     *         description: BitSet constants
     */
    private async handleBitSets(_req: Request, res: Response): Promise<void> {
        const h = this.handler(res); if (!h) return;
        res.json(h.getBitSets());
    }
}
