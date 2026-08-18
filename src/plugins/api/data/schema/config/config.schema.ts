import { z } from 'zod';

const httpMethod = z.enum([
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'
]);

const originPattern = z.string().min(1);

const corsSchema = z.object({
    allowedOrigins: z.array(originPattern).default([]),
    allowedMethods: z.array(httpMethod).default([
        'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'
    ]),
    allowedHeaders: z.array(z.string().min(1)).default([
        'Content-Type', 'Authorization'
    ]),
    exposedHeaders: z.array(z.string().min(1)).default([]),
    credentials: z.boolean().default(false),
    maxAge: z.number().int().nonnegative().max(86400).default(600)
});

const authKeySchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1).default('default'),
    enabled: z.boolean().default(true),
    bits: z.array(z.string().min(1)).optional()
});

const authSchema = z.object({
    enabled: z.boolean().default(true),
    masterKeySource: z.enum(['env', 'config']).default('env'),
    masterKeyEnvVar: z.string().min(1).default('GatewayMasterKey'),
    publicPaths: z.array(z.string().min(1)).default([
        '/api/health',
        '/api/openapi.json'
    ]),
    keys: z.array(authKeySchema).default([])
});

export const configSchema = z
    .object({
        publicBaseUrl: z
            .string()
            .url()
            .optional()
            .or(z.literal('').transform(() => undefined)),
        cors: corsSchema,
        auth: authSchema
    })
    .catchall(z.unknown());

export default configSchema;