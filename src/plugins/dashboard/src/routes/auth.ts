import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError } from '../lib/http.js';
import { isGloballyBanned } from '../lib/db.js';
import { BOT_OWNER_BIT } from '../lib/bits.js';
import { tokens } from '../lib/tokens.js';
import type PermissionsHandler from '../../../permissions/src/handlers/manager.js';

interface DiscordMeResponse {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
}

export default class AuthRoute extends BaseRoute {
    public readonly basePath = '/api/dash/auth';

    private get permissions(): PermissionsHandler | undefined {
        return this.heart.system.handler.$get('permissions', 'manager') as PermissionsHandler | undefined;
    }

    protected register(): void {
        applyGateway(this.heart, this.router);

        this.router.get('/resolve', this.asyncHandler(guarded(this.heart, this.resolve.bind(this))));
        this.router.get(
            '/permissions',
            requireSession(this.heart),
            this.asyncHandler(guarded(this.heart, this.permissionsFor.bind(this))),
        );
        this.router.get(
            '/session-check',
            requireSession(this.heart),
            this.asyncHandler(guarded(this.heart, this.sessionCheck.bind(this))),
        );
    }

    private async resolve(req: Request, res: Response): Promise<void> {
        const discordToken = req.header('X-Discord-Access-Token');
        const deviceId = req.header('X-Dash-Device-Id');
        if (!discordToken) throw new HttpError(400, 'bad_request', 'Missing X-Discord-Access-Token header.');
        if (!deviceId) throw new HttpError(400, 'bad_request', 'Missing X-Dash-Device-Id header.');

        const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : undefined;

        const discordRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${discordToken}` },
        });
        if (!discordRes.ok) {
            throw new HttpError(401, 'invalid_discord_token', 'Could not verify Discord access token.');
        }
        const me = (await discordRes.json()) as DiscordMeResponse;

        if (await isGloballyBanned(this.heart, me.id)) {
            throw new HttpError(403, 'banned', 'This account is banned from the dashboard.');
        }

        const t = tokens(this.heart);
        const sessionCfg = this.heart.assets.config.get('session') as { ttlSeconds?: number } | undefined;

        const token = await t.issueWithResolvedBits(me.id, guildId, {
            deviceId,
            deviceLabel: 'dashboard-web',
            ttlSeconds: sessionCfg?.ttlSeconds,
        });

        const verified = await t.verify(token);

        ok(res, {
            token,
            expiresAt: verified.payload.exp,
            profile: {
                id: me.id,
                username: me.username,
                displayName: me.global_name ?? me.username,
                avatarUrl: me.avatar
                    ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png`
                    : null,
            },
            bits: verified.payload.bits,
            isBotOwner: verified.payload.bits.includes(BOT_OWNER_BIT),
        });
    }

    private async permissionsFor(req: DashRequest, res: Response): Promise<void> {
        const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : undefined;
        const perms = this.permissions;
        if (!perms) throw new HttpError(500, 'internal', 'Permissions handler unavailable.');

        const guildOwnerId = guildId ? this.heart.client.guilds.cache.get(guildId)?.ownerId : undefined;
        const resolved = await perms.resolve(req.dashSession!.payload.userId, guildId, guildOwnerId);
        ok(res, { ...resolved, bits: [...resolved.bits] });
    }

    private async sessionCheck(req: DashRequest, res: Response): Promise<void> {
        const banned = await isGloballyBanned(this.heart, req.dashSession!.payload.userId);
        if (banned) throw new HttpError(403, 'banned', 'This account is banned from the dashboard.');
        ok(res, { valid: true, userId: req.dashSession!.payload.userId, expiresAt: req.dashSession!.payload.exp });
    }
}
