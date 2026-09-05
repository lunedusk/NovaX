import { z } from 'zod';

const leaf = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const node: z.ZodType<unknown> = z.lazy(() =>
    z.union([leaf, z.array(node), z.record(z.string(), node)])
);

const nonEmpty = z.string().min(1);

const adminTitles = z
    .object({
        access: nonEmpty,
        system: nonEmpty,
        restart: nonEmpty,
        config: nonEmpty,
        lang: nonEmpty,
        emoji: nonEmpty,
        plugin: nonEmpty,
        cache: nonEmpty,
        gate: nonEmpty,
        env: nonEmpty,
        audit: nonEmpty,
        errors: nonEmpty,
        bitHolders: nonEmpty,
        metrics: nonEmpty,
        shard: nonEmpty,
        fleet: nonEmpty,
        worker: nonEmpty,
    })
    .catchall(node);

const adminReload = z
    .object({
        configDescription: nonEmpty,
        langDescription: nonEmpty,
        emojiDescription: nonEmpty,
        pluginDescription: nonEmpty,
        envDescription: nonEmpty,
        fileDescription: nonEmpty,
        namespaceDescription: nonEmpty,
        idDescription: nonEmpty,
        configSuccess: nonEmpty,
        configError: nonEmpty,
        langSuccess: nonEmpty,
        langError: nonEmpty,
        emojiSuccess: nonEmpty,
        emojiError: nonEmpty,
        pluginSuccess: nonEmpty,
        pluginError: nonEmpty,
        envSuccess: nonEmpty,
    })
    .catchall(node);

const adminCache = z
    .object({
        listDescription: nonEmpty,
        popDescription: nonEmpty,
        targetDescription: nonEmpty,
        popped: nonEmpty,
        unknown: nonEmpty,
        listEmpty: nonEmpty,
        listHeader: nonEmpty,
        listLine: nonEmpty,
    })
    .catchall(node);

const adminAudit = z
    .object({
        listDescription: nonEmpty,
        getDescription: nonEmpty,
        idDescription: nonEmpty,
        limitDescription: nonEmpty,
        actorDescription: nonEmpty,
        actionDescription: nonEmpty,
        outcomeDescription: nonEmpty,
        listEmpty: nonEmpty,
        listHeader: nonEmpty,
        listLine: nonEmpty,
        getHeader: nonEmpty,
        getBody: nonEmpty,
        notFound: nonEmpty,
        exportDescription: nonEmpty,
        exportEmpty: nonEmpty,
        exportDone: nonEmpty,
    })
    .catchall(node);

const adminErrors = z
    .object({
        listDescription: nonEmpty,
        getDescription: nonEmpty,
        idDescription: nonEmpty,
        limitDescription: nonEmpty,
        codeDescription: nonEmpty,
        categoryDescription: nonEmpty,
        severityDescription: nonEmpty,
        listEmpty: nonEmpty,
        listHeader: nonEmpty,
        listLine: nonEmpty,
        getHeader: nonEmpty,
        getBody: nonEmpty,
        notFound: nonEmpty,
        exportDescription: nonEmpty,
        exportEmpty: nonEmpty,
        exportDone: nonEmpty,
    })
    .catchall(node);

const adminBitHolders = z
    .object({
        description: nonEmpty,
        bitDescription: nonEmpty,
        pageDescription: nonEmpty,
        unavailable: nonEmpty,
        empty: nonEmpty,
        sectionBotWide: nonEmpty,
        sectionGuild: nonEmpty,
        continued: nonEmpty,
        memberLine: nonEmpty,
        pageHeader: nonEmpty,
    })
    .catchall(node);


const adminGate = z
    .object({
        disabled: nonEmpty,
        guildBlockDescription: nonEmpty,
        guildUnblockDescription: nonEmpty,
        guildListDescription: nonEmpty,
        pluginBlockDescription: nonEmpty,
        pluginUnblockDescription: nonEmpty,
        pluginListDescription: nonEmpty,
        guildIdDescription: nonEmpty,
        pluginIdDescription: nonEmpty,
        reasonDescription: nonEmpty,
        notReady: nonEmpty,
        needGuild: nonEmpty,
        guildBlocked: nonEmpty,
        guildUnblocked: nonEmpty,
        guildNotBlocked: nonEmpty,
        pluginBlocked: nonEmpty,
        pluginUnblocked: nonEmpty,
        pluginNotBlocked: nonEmpty,
        listEmpty: nonEmpty,
        guildListHeader: nonEmpty,
        pluginListHeader: nonEmpty,
    })
    .catchall(node);

const adminAccess = z
    .object({
        blacklistAddDescription: nonEmpty,
        blacklistRemoveDescription: nonEmpty,
        blacklistListDescription: nonEmpty,
        whitelistAddDescription: nonEmpty,
        whitelistRemoveDescription: nonEmpty,
        whitelistListDescription: nonEmpty,
        checkDescription: nonEmpty,
        guildIdDescription: nonEmpty,
        reasonDescription: nonEmpty,
        disabled: nonEmpty,
        notReady: nonEmpty,
        needGuild: nonEmpty,
        blacklisted: nonEmpty,
        unblacklisted: nonEmpty,
        notOnBlacklist: nonEmpty,
        whitelisted: nonEmpty,
        unwhitelisted: nonEmpty,
        notOnWhitelist: nonEmpty,
        listEmpty: nonEmpty,
        listHeader: nonEmpty,
        listLine: nonEmpty,
        checkResult: nonEmpty,
        title: nonEmpty,
    })
    .catchall(node);

const adminCommands = z
    .object({
        description: nonEmpty,
        titles: adminTitles,
        reload: adminReload,
        cache: adminCache,
        audit: adminAudit,
        errors: adminErrors,
        bitHolders: adminBitHolders,
        gate: adminGate,
        access: adminAccess,
    })
    .catchall(node);

const commandsSection = z
    .object({
        admin: adminCommands,
    })
    .catchall(node);

const errorsDiscord = z
    .object({
        permission_denied: nonEmpty,
        hierarchy: nonEmpty,
        target_is_owner: nonEmpty,
    })
    .catchall(node);

const errorsCodes = z
    .object({
        COMMAND_FAILED: nonEmpty,
        PAGINATOR_EXPIRED: nonEmpty,
        HIERARCHY_RANK: nonEmpty,
        ROLE_BITS_MISSING: nonEmpty,
        MISSING_BIT: nonEmpty,
    })
    .catchall(node);

const errorsSection = z
    .object({
        discord: errorsDiscord,
        codes: errorsCodes,
    })
    .catchall(node);

export const langSchema = z
    .object({
        commands: commandsSection,
        layouts: z.record(z.string(), node),
        errors: errorsSection,
    })
    .catchall(node);

export default langSchema;
