import { z } from 'zod';

export const defaultPluginConfigSchema = z
    .object({
        enabled: z.boolean().optional()
    })
    .catchall(z.unknown());
