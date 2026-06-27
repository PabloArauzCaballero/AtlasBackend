import { z } from 'zod';

export const riskCustomerIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export type RiskCustomerIdParamsDto = z.infer<typeof riskCustomerIdParamsSchema>;
