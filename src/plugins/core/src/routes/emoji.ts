import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import { emojis } from '#core/manager/emoji.js';
import type GatewayManager from '../../../api/src/handlers/manager.js';

/**
 * @openapi
 * /api/emoji:
 *   get:
 *     tags: [Emoji]
 *     summary: List emoji map keys
 *     description: Requires bit bot.emoji.view.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Emoji map
 * /api/emoji/{key}:
 *   get:
 *     tags: [Emoji]
 *     summary: Get one emoji by key
 *     description: Requires bit bot.emoji.view.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Emoji value
 *       '404':
 *         description: Not found
 * /api/emoji/reload:
 *   post:
 *     tags: [Emoji]
 *     summary: Reload emoji map from disk
 *     description: Requires bit bot.emoji.manage.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Reload result
 */

export default class EmojiApiRoute extends BaseRoute {
    public readonly basePath = '/api/emoji';

    private get api(): GatewayManager | undefined {
        return this.heart.system.handler.$get('api', 'manager') as GatewayManager | undefined;
    }

    private param(req: Request, key: string): string {
        const val = req.params[key];
        return Array.isArray(val) ? val[0] : String(val ?? '');
    }

    protected register(): void {
        this.api?.applyMiddleware(this.router);

        this.router.get('/', this.asyncHandler(this.list.bind(this)));
        this.router.get('/:key', this.asyncHandler(this.getOne.bind(this)));
        this.router.post('/reload', this.asyncHandler(this.reload.bind(this)));
    }

    private async list(_req: Request, res: Response): Promise<void> {
        res.json({ emojis: emojis.getAll() });
    }

    private async getOne(req: Request, res: Response): Promise<void> {
        const key = this.param(req, 'key');
        if (!key) {
            res.status(400).json({ error: 'key is required' });
            return;
        }
        const value = emojis.get(key);
        if (value === null) {
            res.status(404).json({ error: 'EMOJI_NOT_FOUND', key });
            return;
        }
        res.json({ key, value });
    }

    private async reload(_req: Request, res: Response): Promise<void> {
        const ok = await emojis.reload();
        res.json({ reloaded: ok, count: Object.keys(emojis.getAll()).length });
    }
}
