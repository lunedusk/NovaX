import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireAuthedBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, toStringArray, requireBody } from '../lib/http.js';
import { writeAudit } from '../lib/db.js';
import { permissions, findBotRole } from '../lib/roles.js';
import { BITS } from '../lib/bits.js';

type RoleParams = { roleId: string };

export default class AdminRolesRoute extends BaseRoute {
    public readonly basePath = '/api/dash/admin/roles';

    protected register(): void {
        applyGateway(this.heart, this.router);
        const manage = requireAuthedBit(this.heart, BITS.BOT_ROLES_MANAGE);

        this.router.get('/', ...manage, this.asyncHandler(guarded(this.heart, this.list.bind(this))));
        this.router.post('/', ...manage, this.asyncHandler(guarded(this.heart, this.create.bind(this))));
        this.router.get('/:roleId', ...manage, this.asyncHandler(guarded(this.heart, this.detail.bind(this))));
        this.router.put('/:roleId', ...manage, this.asyncHandler(guarded(this.heart, this.update.bind(this))));
        this.router.delete('/:roleId', ...manage, this.asyncHandler(guarded(this.heart, this.remove.bind(this))));
        this.router.post('/:roleId/assign', ...manage, this.asyncHandler(guarded(this.heart, this.assign.bind(this))));
        this.router.post('/:roleId/revoke', ...manage, this.asyncHandler(guarded(this.heart, this.revoke.bind(this))));
    }

    private async list(_req: DashRequest, res: Response): Promise<void> {
        ok(res, await permissions(this.heart).listBotRoles());
    }

    private async create(req: DashRequest, res: Response): Promise<void> {
        const body = requireBody<{ name: string; color: string; bits?: string[] }>(req.body, ['name', 'color']);
        const role = await permissions(this.heart).createBotRole({
            name: body.name,
            color: body.color,
            bits: toStringArray(body.bits ?? []),
            createdBy: req.dashSession!.payload.userId,
        });

        await writeAudit(this.heart, {
            actorId: req.dashSession!.payload.userId,
            action: 'role.bw.create',
            target: role._id,
        });
        ok(res, role, 201);
    }

    private async detail(req: DashRequest<RoleParams>, res: Response): Promise<void> {
        const role = await findBotRole(this.heart, req.params.roleId);
        if (!role) throw new HttpError(404, 'not_found', `Role ${req.params.roleId} not found.`);
        ok(res, role);
    }

    private async update(req: DashRequest<RoleParams>, res: Response): Promise<void> {
        const body = (req.body ?? {}) as { name?: string; color?: string; bits?: string[] };
        const role = await permissions(this.heart).updateBotRole(req.params.roleId, {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.color !== undefined ? { color: body.color } : {}),
            ...(body.bits !== undefined ? { bits: toStringArray(body.bits) } : {}),
        });
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'role.bw.update', target: req.params.roleId });
        ok(res, role);
    }

    private async remove(req: DashRequest<RoleParams>, res: Response): Promise<void> {
        await permissions(this.heart).deleteBotRole(req.params.roleId);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'role.bw.delete', target: req.params.roleId });
        ok(res, { deleted: true });
    }

    private async assign(req: DashRequest<RoleParams>, res: Response): Promise<void> {
        const userIds = toStringArray(req.body?.userIds);
        if (userIds.length === 0) throw new HttpError(400, 'bad_request', 'userIds must be a non-empty array.');
        await permissions(this.heart).assignBotRole(req.params.roleId, userIds);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'role.bw.assign', target: req.params.roleId, meta: { userIds } });
        ok(res, { roleId: req.params.roleId, assigned: userIds });
    }

    private async revoke(req: DashRequest<RoleParams>, res: Response): Promise<void> {
        const userIds = toStringArray(req.body?.userIds);
        if (userIds.length === 0) throw new HttpError(400, 'bad_request', 'userIds must be a non-empty array.');
        await permissions(this.heart).revokeBotRole(req.params.roleId, userIds);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'role.bw.revoke', target: req.params.roleId, meta: { userIds } });
        ok(res, { roleId: req.params.roleId, revoked: userIds });
    }
}
