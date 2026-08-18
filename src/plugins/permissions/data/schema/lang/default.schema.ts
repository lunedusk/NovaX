import { z } from 'zod';

const leaf = z.union([z.string(), z.number(), z.boolean(), z.null()]);

type LangNode = string | number | boolean | null | { [k: string]: LangNode };

const langNode: z.ZodType<LangNode> = z.lazy(() =>
    z.union([leaf, z.record(z.string(), langNode)])
);

const layoutsSchema = z.object({
    containerSuccess: z.string().min(1),
    containerError: z.string().min(1),
    containerInfo: z.string().min(1)
}).catchall(z.string());

export const configSchema = z
    .object({
        commands: z
            .object({
                permissions: langNode
            })
            .catchall(langNode),
        layouts: layoutsSchema
    })
    .catchall(langNode);

export default configSchema;