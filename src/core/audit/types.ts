export type AuditActorType = 'user' | 'api_key' | 'system';

export type AuditOutcome = 'success' | 'fail';

export type AuditActionCode =
    | 'token.issue'
    | 'token.refresh'
    | 'token.revoke_device'
    | 'token.revoke_all'
    | 'perm.bit.register'
    | 'perm.role.create'
    | 'perm.role.update'
    | 'perm.role.delete'
    | 'perm.role.assign'
    | 'perm.role.revoke'
    | 'gate.guild.block'
    | 'gate.guild.unblock'
    | 'gate.plugin.block'
    | 'gate.plugin.unblock'
    | 'admin.reload.env'
    | 'admin.reload.config'
    | 'admin.reload.lang'
    | 'admin.reload.emoji'
    | 'admin.cache.pop'
    | 'updater.apply'
    | 'plugin.enable'
    | 'plugin.disable';

export type AuditMetaValue = string | number | boolean | null;

export type AuditMeta = Record<string, AuditMetaValue>;

export interface AuditRecordInput {
    actorType: AuditActorType;
    actorId: string;
    action: AuditActionCode | string;
    target: string;
    outcome: AuditOutcome;
    reason?: string;
    meta?: Record<string, unknown>;
}

export interface AuditRecord {
    id: string;
    actorType: AuditActorType;
    actorId: string;
    action: string;
    target: string;
    outcome: AuditOutcome;
    reason: string | null;
    meta: AuditMeta;
    createdAt: number;
}
