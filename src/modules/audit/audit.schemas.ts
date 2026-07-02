import { z } from 'zod';

export const auditCustomerParamsSchema = z.object({ customerId: z.string().regex(/^[1-9][0-9]*$/) });
export const auditQuerySchema = z.object({
  eventType: z
    .enum(['all', 'status', 'auth', 'consent', 'risk', 'manual_review', 'fraud', 'data_change', 'customer_action'])
    .default('all'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type AuditCustomerParamsDto = z.infer<typeof auditCustomerParamsSchema>;
export type AuditQueryDto = z.infer<typeof auditQuerySchema>;
