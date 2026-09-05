import type { DashSurfaceBase, DashSurfaceResolved } from '#core/types/dashSdk.js';

export type DashCapability =
    | 'ui.resize'
    | 'ui.toast'
    | 'ui.navigate'
    | 'ui.modal'
    | 'ui.log'
    | 'storage.get'
    | 'storage.set'
    | 'storage.del'
    | 'realtime.subscribe'
    | 'api.read'
    | 'api.write'
    | `api.path:${string}`;

const DEFAULT_CAPS: DashCapability[] = [
    'ui.resize',
    'ui.toast',
    'ui.log',
    'storage.get',
    'storage.set',
    'storage.del',
    'api.read',
];

const WRITE_CAPS: DashCapability[] = ['api.write', 'ui.navigate', 'ui.modal', 'realtime.subscribe'];

export interface GrantContext {
    bits: ReadonlySet<string>;
    userId: string;
    isEnvOwner: boolean;
    pluginId: string;
    surface: DashSurfaceBase | DashSurfaceResolved;
}

function hasRequiredBits(
    bits: ReadonlySet<string>,
    required: string[] | undefined,
    mode: 'all' | 'any' = 'all',
): boolean {
    if (!required || required.length === 0) return true;
    if (bits.has('bot.owner')) return true;
    if (mode === 'any') return required.some((b) => bits.has(b));
    return required.every((b) => bits.has(b));
}

export function computeSurfaceGrants(ctx: GrantContext): {
    capabilities: DashCapability[];
    pathPatterns: string[];
    canWrite: boolean;
} {
    const v = ctx.surface.visibility;
    if (v?.denyUserIds?.includes(ctx.userId)) {
        return { capabilities: [], pathPatterns: [], canWrite: false };
    }
    if (v?.envOwnerOnly && !ctx.isEnvOwner && !ctx.bits.has('bot.owner')) {
        return { capabilities: [], pathPatterns: [], canWrite: false };
    }
    if (v?.allowUserIds && v.allowUserIds.length > 0 && !v.allowUserIds.includes(ctx.userId)) {
        return { capabilities: [], pathPatterns: [], canWrite: false };
    }

    const readBits = v?.readBits ?? v?.requiredBits ?? [];
    const writeBits = v?.writeBits ?? v?.requiredBits ?? [];
    const mode = v?.bitsMode ?? 'all';

    if (!hasRequiredBits(ctx.bits, readBits, mode)) {
        return { capabilities: [], pathPatterns: [], canWrite: false };
    }

    const canWrite = hasRequiredBits(ctx.bits, writeBits, mode);
    const capabilities: DashCapability[] = [...DEFAULT_CAPS];
    if (canWrite) {
        for (const c of WRITE_CAPS) capabilities.push(c);
    }

    const pathPatterns = [
        `/api/dash/plugins/${ctx.pluginId}`,
        `/api/dash/plugins/${ctx.pluginId}/*`,
    ];
    for (const p of pathPatterns) {
        capabilities.push(`api.path:${p}`);
    }

    return { capabilities, pathPatterns, canWrite };
}

export function hasCapability(grants: readonly string[], needed: string): boolean {
    return grants.includes(needed);
}
