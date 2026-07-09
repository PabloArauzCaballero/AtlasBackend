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

/**
 * ATLAS-P11-T10: query schema para `GET /operations/audit/customer/:customerId/feed`, la
 * variante por cursor real (respaldada por la vista `audit_event_feed`) de
 * `GET /operations/audit/customer/:customerId`.
 */
export const auditFeedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.string().trim().min(1).max(500).optional(),
});
export type AuditFeedQueryDto = z.infer<typeof auditFeedQuerySchema>;
