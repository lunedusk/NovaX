import { SemVer } from '#core/utils/semver.js';
import type { CompatMode, DesiredState, PluginIdVersion, RegisterReasonCode } from '../types.js';

export interface DeepCheckResult {
    readonly ok: boolean;
    readonly reason: RegisterReasonCode;
    readonly message: string;
}

function pluginKey(p: PluginIdVersion): string {
    return `${p.id}@${p.version}`;
}

function sortedPluginKeys(plugins: readonly PluginIdVersion[]): string[] {
    return plugins.map(pluginKey).sort((a, b) => a.localeCompare(b));
}

function samePluginIds(
    desired: readonly PluginIdVersion[],
    incoming: readonly PluginIdVersion[],
): boolean {
    const a = new Set(desired.map((p) => p.id));
    const b = new Set(incoming.map((p) => p.id));
    if (a.size !== b.size) return false;
    for (const id of a) {
        if (!b.has(id)) return false;
    }
    return true;
}

function findDesiredVersion(
    desired: readonly PluginIdVersion[],
    id: string,
): string | undefined {
    return desired.find((p) => p.id === id)?.version;
}

export function runDeepCheck(
    mode: CompatMode,
    desired: DesiredState,
    incoming: {
        zeneVersion: string;
        plugins: readonly PluginIdVersion[];
    },
): DeepCheckResult {
    if (mode === 'strict') {
        if (incoming.zeneVersion !== desired.zeneVersion) {
            return {
                ok: false,
                reason: 'VERSION_MISMATCH_STRICT',
                message: `Zene version mismatch (strict): worker=${incoming.zeneVersion} desired=${desired.zeneVersion}`,
            };
        }
        const want = sortedPluginKeys(desired.plugins);
        const got = sortedPluginKeys(incoming.plugins);
        if (want.length !== got.length || want.some((k, i) => k !== got[i])) {
            return {
                ok: false,
                reason: 'PLUGIN_SET_MISMATCH',
                message: `Plugin set mismatch (strict): desired=[${want.join(',')}] worker=[${got.join(',')}]`,
            };
        }
        return { ok: true, reason: 'OK', message: 'strict compatibility ok' };
    }

    if (!SemVer.satisfies(incoming.zeneVersion, desired.zeneVersion)) {
        return {
            ok: false,
            reason: 'VERSION_OUT_OF_RANGE',
            message: `Zene version out of range: worker=${incoming.zeneVersion} desired=${desired.zeneVersion}`,
        };
    }

    if (!samePluginIds(desired.plugins, incoming.plugins)) {
        return {
            ok: false,
            reason: 'PLUGIN_SET_MISMATCH',
            message: 'Plugin id set differs from desired state (range mode still requires identical plugin ids)',
        };
    }

    for (const plugin of incoming.plugins) {
        const wantVer = findDesiredVersion(desired.plugins, plugin.id);
        if (wantVer === undefined) {
            return {
                ok: false,
                reason: 'PLUGIN_SET_MISMATCH',
                message: `Plugin ${plugin.id} not in desired state`,
            };
        }
        if (plugin.version !== wantVer && !SemVer.satisfies(plugin.version, wantVer)) {
            return {
                ok: false,
                reason: 'VERSION_OUT_OF_RANGE',
                message: `Plugin ${plugin.id} version ${plugin.version} does not satisfy desired ${wantVer}`,
            };
        }
    }

    return { ok: true, reason: 'OK', message: 'range compatibility ok' };
}
