import { i18n } from '#core/manager/lang.js';
import { resolveGlobalPlaceholders } from '#core/placeholder/index.js';

const LANG_NS = 'core';

export type CoreErrorCode =
    | 'COMMAND_FAILED'
    | 'STRUCTURE_LOCKED'
    | 'DUPLICATE_COMMAND'
    | 'PAGINATOR_EXPIRED'
    | 'PAGINATOR_AUTHOR_ONLY'
    | 'PAGINATOR_CLOSED'
    | 'HIERARCHY_RANK'
    | 'HIERARCHY_EQUAL'
    | 'HIERARCHY_ENV_OWNER'
    | 'ROLE_BITS_MISSING'
    | 'SERVER_PROTECTED_MUTATE'
    | 'BOT_PROTECTED_MUTATE'
    | 'BOT_OWNER_MUTATE'
    | 'MIRROR_OFF'
    | 'MIRROR_ON'
    | 'LINKS_EMPTY'
    | 'GUILD_MEMBERS_INTENT'
    | 'RATE_LIMIT'
    | 'INTERNAL'
    | 'FORBIDDEN'
    | 'MISSING_BIT';

export type CoreErrorVars = Record<string, string | number | boolean | null | undefined>;

export function coreErrorMessage(code: CoreErrorCode, vars?: CoreErrorVars): string {
    const key = `errors.codes.${code}`;
    const msg = i18n.get(LANG_NS, key, vars as Record<string, string | number> | undefined);
    if (msg === `${LANG_NS}:${key}`) {
        return resolveGlobalPlaceholders(`%%emoji_cross%% ${code}`);
    }
    return resolveGlobalPlaceholders(msg);
}

export function coreErrorTitle(code: CoreErrorCode): string {
    const key = `errors.titles.${code}`;
    const title = i18n.get(LANG_NS, key);
    if (title === `${LANG_NS}:${key}`) {
        return code;
    }
    return title;
}
