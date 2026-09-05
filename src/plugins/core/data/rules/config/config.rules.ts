import type { ValidationContext } from '#core/validation/index.js';
import type { IHeart } from '#core/heart/index.js';

const ENGINES = new Set(['sqlite', 'postgres', 'mongo', 'native-pg', 'native-sqlite']);
const ACTIVITY_TYPES = new Set(['PLAYING', 'STREAMING', 'LISTENING', 'WATCHING', 'COMPETING', 'CUSTOM']);
const STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);

export async function validate(
    data: unknown,
    _ctx: ValidationContext,
    heart?: IHeart | null,
): Promise<true | string | string[]> {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return 'core config must be a plain object';
    }

    const d = data as {
        status?: string;
        updateIntervalSeconds?: number;
        activities?: Array<{ name?: string; type?: string; url?: string }>;
        dataBackend?: { engine?: string; alias?: string };
        guildGate?: { enabled?: boolean };
        guildAccess?: {
            enabled?: boolean;
            conflictPriority?: string;
            emptyWhitelistMeans?: string;
            leaveOnBoot?: boolean;
            leaveOnJoin?: boolean;
            allowOwner?: boolean;
            leaveReason?: string;
        };
        guildLocale?: { enabled?: boolean };
        guildLangFiles?: { enabled?: boolean };
        help?: { maxCharsPerPage?: number };
    };

    const issues: string[] = [];

    if (d.status != null && !STATUSES.has(String(d.status))) {
        issues.push(`status must be one of ${[...STATUSES].join(', ')}`);
    }

    if (d.updateIntervalSeconds != null) {
        if (typeof d.updateIntervalSeconds !== 'number' || d.updateIntervalSeconds < 5) {
            issues.push('updateIntervalSeconds must be a number >= 5 when set');
        }
    }

    if (Array.isArray(d.activities)) {
        for (let i = 0; i < d.activities.length; i++) {
            const a = d.activities[i] ?? {};
            if (!a.name || !String(a.name).trim()) {
                issues.push(`activities[${i}].name is required`);
            }
            if (a.type != null && !ACTIVITY_TYPES.has(String(a.type).toUpperCase())) {
                issues.push(`activities[${i}].type unsupported: ${a.type}`);
            }
            if (String(a.type ?? '').toUpperCase() === 'STREAMING' && a.url != null && !/^https?:\/\//i.test(String(a.url))) {
                issues.push(`activities[${i}].url must be http(s) when type is STREAMING`);
            }
        }
    }

    const eng = d.dataBackend?.engine?.toLowerCase();
    if (eng && !ENGINES.has(eng)) {
        issues.push(`dataBackend.engine unsupported: ${eng}`);
    }
    if (d.dataBackend?.alias != null && !String(d.dataBackend.alias).trim()) {
        issues.push('dataBackend.alias must be non-empty when set');
    }

    if (
        d.guildAccess?.conflictPriority &&
        !['blacklist', 'whitelist'].includes(d.guildAccess.conflictPriority)
    ) {
        issues.push('guildAccess.conflictPriority must be blacklist or whitelist');
    }

    if (
        d.guildAccess?.emptyWhitelistMeans &&
        !['allow_all', 'deny_all'].includes(d.guildAccess.emptyWhitelistMeans)
    ) {
        issues.push('guildAccess.emptyWhitelistMeans must be allow_all or deny_all');
    }

    if (d.guildAccess?.leaveReason != null && !String(d.guildAccess.leaveReason).trim()) {
        issues.push('guildAccess.leaveReason must be non-empty when set');
    }
    if (d.guildAccess?.leaveReason != null && String(d.guildAccess.leaveReason).length > 500) {
        issues.push('guildAccess.leaveReason must be <= 500 characters');
    }

    if (d.help?.maxCharsPerPage != null) {
        if (typeof d.help.maxCharsPerPage !== 'number' || d.help.maxCharsPerPage < 500) {
            issues.push('help.maxCharsPerPage must be a number >= 500 when set');
        }
    }

    if (issues.length > 0) {
        return issues;
    }

    if (heart && eng) {
        heart.log.debug(
            `core config rules: dataBackend.engine=${eng} alias=${d.dataBackend?.alias ?? 'main'}`,
        );
    }

    return true;
}

export default validate;
