import { z } from 'zod';

export const commonConfigSchema = z
    .object({
        __info__: z
            .object({
                __author__: z.string(),
                version: z.string().optional(),
                license: z.string().optional()
            })
            .catchall(z.unknown())
            .optional(),
        ENVSettings: z.boolean().optional(),
        DiscordToken: z.string().optional(),
        DiscordIntents: z.union([z.array(z.union([z.string(), z.number()])), z.string()]).optional(),
        TZ: z.string().optional(),
        DefaultLocale: z.string().optional(),
        APIPort: z.union([z.number(), z.string()]).optional(),
        LogLevel: z.string().optional(),
        Database: z.unknown().optional(),
        isSharded: z.boolean().optional(),
        hotReloadEnabled: z.boolean().optional(),
        BotName: z.string().optional(),
        MainGuildName: z.string().optional(),
        SmtpHost: z.string().optional(),
        SmtpPort: z.union([z.number(), z.string()]).optional(),
        SmtpUser: z.string().optional(),
        SmtpPass: z.string().optional()
    })
    .catchall(z.unknown());

export type CommonConfigParsed = z.infer<typeof commonConfigSchema>;
