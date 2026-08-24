import type { Response } from 'express';
import type { AuditActorType } from './types.js';

export interface GatewayAuthLocals {
    isMaster: boolean;
    label: string;
    bits: string[];
}

export function actorFromGateway(res: Response): { actorType: AuditActorType; actorId: string } {
    const auth = res.locals.gatewayAuth as GatewayAuthLocals | undefined;
    if (!auth) {
        return { actorType: 'system', actorId: 'system' };
    }
    if (auth.isMaster) {
        return { actorType: 'api_key', actorId: 'master' };
    }
    const label = typeof auth.label === 'string' ? auth.label.trim() : '';
    return { actorType: 'api_key', actorId: label || 'api_key' };
}

export function actorFromUser(userId: string): { actorType: AuditActorType; actorId: string } {
    return { actorType: 'user', actorId: userId };
}

export function actorSystem(): { actorType: AuditActorType; actorId: string } {
    return { actorType: 'system', actorId: 'system' };
}
