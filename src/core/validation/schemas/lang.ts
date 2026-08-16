import { z } from 'zod';

const langLeaf = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const langDocumentSchema: z.ZodType<unknown> = z.lazy(() =>
    z.record(
        z.string(),
        z.union([langLeaf, z.array(langLeaf), langDocumentSchema])
    )
);
