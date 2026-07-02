import { z } from 'zod';

export const customerIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export type CustomerIdParamsDto = z.infer<typeof customerIdParamsSchema>;
