import type { ValidationContext } from '#core/validation/index.js';
import type { IHeart } from '#core/heart/index.js';

function asRecord(v: unknown): Record<string, unknown> | null {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
}

function requireStringPath(root: Record<string, unknown>, path: string, issues: string[]): void {
    const parts = path.split('.');
    let cur: unknown = root;
    for (const p of parts) {
        const obj = asRecord(cur);
        if (!obj || !(p in obj)) {
            issues.push(`missing required lang key: ${path}`);
            return;
        }
        cur = obj[p];
    }
    if (typeof cur !== 'string' || !cur.trim()) {
        issues.push(`lang key must be a non-empty string: ${path}`);
    }
}

const REQUIRED_ADMIN_KEYS = [
    'commands.admin.description',
    'commands.admin.titles.access',
    'commands.admin.titles.system',
    'commands.admin.titles.restart',
    'commands.admin.titles.config',
    'commands.admin.titles.lang',
    'commands.admin.titles.emoji',
    'commands.admin.titles.plugin',
    'commands.admin.titles.cache',
    'commands.admin.titles.gate',
    'commands.admin.titles.env',
    'commands.admin.titles.audit',
    'commands.admin.titles.errors',
    'commands.admin.reload.configDescription',
    'commands.admin.reload.langDescription',
    'commands.admin.reload.emojiDescription',
    'commands.admin.reload.pluginDescription',
    'commands.admin.reload.envDescription',
    'commands.admin.reload.envSuccess',
    'commands.admin.reload.configSuccess',
    'commands.admin.reload.langSuccess',
    'commands.admin.reload.emojiSuccess',
    'commands.admin.reload.pluginSuccess',
    'commands.admin.cache.listDescription',
    'commands.admin.cache.popDescription',
    'commands.admin.cache.targetDescription',
    'commands.admin.cache.popped',
    'commands.admin.cache.unknown',
    'commands.admin.cache.listEmpty',
    'commands.admin.cache.listHeader',
    'commands.admin.cache.listLine',
    'commands.admin.audit.listDescription',
    'commands.admin.audit.getDescription',
    'commands.admin.audit.idDescription',
    'commands.admin.audit.limitDescription',
    'commands.admin.audit.actorDescription',
    'commands.admin.audit.actionDescription',
    'commands.admin.audit.outcomeDescription',
    'commands.admin.audit.listEmpty',
    'commands.admin.audit.listHeader',
    'commands.admin.audit.listLine',
    'commands.admin.audit.getHeader',
    'commands.admin.audit.getBody',
    'commands.admin.audit.notFound',
    'commands.admin.audit.exportDescription',
    'commands.admin.audit.exportEmpty',
    'commands.admin.audit.exportDone',
    'commands.admin.errors.listDescription',
    'commands.admin.errors.getDescription',
    'commands.admin.errors.idDescription',
    'commands.admin.errors.limitDescription',
    'commands.admin.errors.codeDescription',
    'commands.admin.errors.categoryDescription',
    'commands.admin.errors.severityDescription',
    'commands.admin.errors.listEmpty',
    'commands.admin.errors.listHeader',
    'commands.admin.errors.listLine',
    'commands.admin.errors.getHeader',
    'commands.admin.errors.getBody',
    'commands.admin.errors.notFound',
    'commands.admin.errors.exportDescription',
    'commands.admin.errors.exportEmpty',
    'commands.admin.errors.exportDone',
    'commands.admin.titles.bitHolders',
    'commands.admin.bitHolders.description',
    'commands.admin.bitHolders.bitDescription',
    'commands.admin.bitHolders.pageDescription',
    'commands.admin.bitHolders.unavailable',
    'commands.admin.bitHolders.empty',
    'commands.admin.bitHolders.sectionBotWide',
    'commands.admin.bitHolders.sectionGuild',
    'commands.admin.bitHolders.continued',
    'commands.admin.bitHolders.memberLine',
    'commands.admin.bitHolders.pageHeader',
    'commands.admin.titles.metrics',
    'commands.admin.titles.shard',
    'commands.admin.titles.fleet',
    'commands.admin.titles.worker',
    'commands.admin.gate.disabled',
    'commands.admin.gate.guildBlockDescription',
    'commands.admin.gate.guildUnblockDescription',
    'commands.admin.gate.guildListDescription',
    'commands.admin.gate.pluginBlockDescription',
    'commands.admin.gate.pluginUnblockDescription',
    'commands.admin.gate.pluginListDescription',
    'commands.admin.gate.guildIdDescription',
    'commands.admin.gate.notReady',
    'commands.admin.gate.needGuild',
    'commands.admin.access.blacklistAddDescription',
    'commands.admin.access.blacklistRemoveDescription',
    'commands.admin.access.blacklistListDescription',
    'commands.admin.access.whitelistAddDescription',
    'commands.admin.access.whitelistRemoveDescription',
    'commands.admin.access.whitelistListDescription',
    'commands.admin.access.checkDescription',
    'commands.admin.access.guildIdDescription',
    'commands.admin.access.disabled',
    'commands.admin.access.notReady',
    'commands.admin.access.needGuild',
    'commands.admin.access.blacklisted',
    'commands.admin.access.unblacklisted',
    'commands.admin.access.whitelisted',
    'commands.admin.access.unwhitelisted',
    'commands.admin.access.checkResult',
    'commands.admin.access.title',
];

export async function validate(
    data: unknown,
    _ctx: ValidationContext,
    heart?: IHeart | null
): Promise<true | string | string[]> {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return 'Language document must be a plain object';
    }
    const d = data as Record<string, unknown>;
    if (!d.commands || typeof d.commands !== 'object') {
        return 'commands section is required';
    }
    if (!d.layouts || typeof d.layouts !== 'object') {
        return 'layouts section is required';
    }

    const issues: string[] = [];
    for (const path of REQUIRED_ADMIN_KEYS) {
        requireStringPath(d, path, issues);
    }
    const errorKeys = [
        'errors.discord.permission_denied',
        'errors.discord.hierarchy',
        'errors.discord.target_is_owner',
        'errors.codes.COMMAND_FAILED',
        'errors.codes.PAGINATOR_EXPIRED',
        'errors.codes.HIERARCHY_RANK',
        'errors.codes.ROLE_BITS_MISSING',
        'errors.codes.MISSING_BIT',
        'layouts.containerError',
        'layouts.containerSuccess',
    ];
    for (const path of errorKeys) {
        requireStringPath(d, path, issues);
    }

    if (issues.length > 0) {
        return issues;
    }
    heart?.log.debug('core lang rules: admin keys ok');
    return true;
}

export default validate;
