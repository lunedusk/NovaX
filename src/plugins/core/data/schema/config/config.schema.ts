import { z } from 'zod';

const activityType = z.enum([
    'PLAYING',
    'STREAMING',
    'LISTENING',
    'WATCHING',
    'COMPETING',
    'CUSTOM',
    'Playing',
    'Streaming',
    'Listening',
    'Watching',
    'Competing',
    'Custom',
]);

export const configSchema = z
    .object({
        enabled: z.boolean().optional(),
        status: z.enum(['online', 'idle', 'dnd', 'invisible']).optional(),
        updateIntervalSeconds: z.number().int().min(5).optional(),
        placeholders: z.record(z.string(), z.unknown()).optional(),
        activities: z
            .array(
                z.object({
                    name: z.string().min(1),
                    type: activityType.or(z.string().min(1)),
                    url: z.string().optional(),
                }),
            )
            .optional(),
        help: z
            .object({
                filterByPermissions: z.boolean().optional(),
                maxCharsPerPage: z.number().int().min(500).optional(),
                ephemeral: z.boolean().optional(),
            })
            .catchall(z.unknown())
            .optional(),
        dataBackend: z
            .object({
                engine: z
                    .enum(['sqlite', 'postgres', 'mongo', 'native-pg', 'native-sqlite'])
                    .optional(),
                alias: z.string().min(1).optional(),
            })
            .catchall(z.unknown())
            .optional(),
        guildGate: z
            .object({
                enabled: z.boolean().optional(),
            })
            .catchall(z.unknown())
            .optional(),
        guildAccess: z
            .object({
                enabled: z.boolean().optional(),
                conflictPriority: z.enum(['blacklist', 'whitelist']).optional(),
                emptyWhitelistMeans: z.enum(['allow_all', 'deny_all']).optional(),
                leaveOnBoot: z.boolean().optional(),
                leaveOnJoin: z.boolean().optional(),
                allowOwner: z.boolean().optional(),
                leaveReason: z.string().min(1).max(500).optional(),
            })
            .catchall(z.unknown())
            .optional(),
        guildLocale: z
            .object({
                enabled: z.boolean().optional(),
            })
            .catchall(z.unknown())
            .optional(),
        guildLangFiles: z
            .object({
                enabled: z.boolean().optional(),
            })
            .catchall(z.unknown())
            .optional(),
    })
    .catchall(z.unknown());

export default configSchema;
