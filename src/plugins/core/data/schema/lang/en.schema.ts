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
    })
    .catchall(node);

const commandsSection = z
    .object({
        admin: adminCommands,
    })
    .catchall(node);

export const langSchema = z
    .object({
        commands: commandsSection,
        layouts: z.record(z.string(), node),
    })
    .catchall(node);

export default langSchema;
