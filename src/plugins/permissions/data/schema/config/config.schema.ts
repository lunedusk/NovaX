import { z } from 'zod';

const discordPermissionName = z.string().min(1);

const levelSchema = z
    .object({
        roleIds: z.array(z.string().min(1)).default([]),
        discordPermissions: z.array(discordPermissionName).default([]),
        denyMessage: z.string().min(1).optional()
    })
    .catchall(z.unknown());

export const configSchema = z
    .object({
        enabled: z.boolean().default(true),
        defaultLevel: z.string().min(1).default('public'),
        levels: z.record(z.string(), levelSchema).default({})
    })
    .catchall(z.unknown());

export default configSchema;