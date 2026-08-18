import { z } from 'zod';

const leaf = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const node: z.ZodType<unknown> = z.lazy(() =>
    z.union([leaf, z.array(node), z.record(z.string(), node)])
);

export const langSchema = z.record(z.string(), node);
export default langSchema;
