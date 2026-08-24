import { z } from 'zod';

export const configSchema = z
    .object({
        enabled: z.boolean().optional(),
        status: z.enum(['online', 'idle', 'dnd', 'invisible']).optional(),
        updateIntervalSeconds: z.number().int().positive().optional(),
        placeholders: z.record(z.string(), z.unknown()).optional(),
        activities: z
            .array(
                z.object({
                    name: z.string(),
                    type: z.string(),
                    url: z.string().optional()
                })
            )
            .optional(),
        help: z
            .object({
                filterByPermissions: z.boolean().optional(),
                maxCharsPerPage: z.number().int().positive().optional(),
                ephemeral: z.boolean().optional()
            })
            .catchall(z.unknown())
            .optional(),
        guildGate: z
            .object({
                engine: z.enum(['sqlite', 'postgres', 'mongo', 'native-pg', 'native-sqlite']).optional(),
                alias: z.string().min(1).optional()
            })
            .catchall(z.unknown())
            .optional()
    })
    .catchall(z.unknown());

export default configSchema;
