import { z } from 'zod';

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const textFilter = z.string().trim().min(1).max(120).optional();
const fields = z
  .string()
  .trim()
  .regex(/^[a-z][A-Za-z0-9]*(,[a-z][A-Za-z0-9]*)*$/, 'fields debe ser una lista CSV de nombres camelCase.')
  .transform((value) => [...new Set(value.split(','))])
  .optional();

const baseListShape = { page, limit, fields };

export const customerViewQuerySchema = z
  .object({
    ...baseListShape,
    q: textFilter,
    status: textFilter,
    riskBand: textFilter,
  })
  .strict();

export const riskViewQuerySchema = z
  .object({
    ...baseListShape,
    customerId: z.coerce.number().int().positive().optional(),
    status: textFilter,
    riskBand: textFilter,
    decision: textFilter,
  })
  .strict();

export const workQueueViewQuerySchema = z
  .object({
    ...baseListShape,
    type: textFilter,
    status: textFilter,
    priority: textFilter,
    severity: textFilter,
    assignedTo: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const providerHealthViewQuerySchema = z
  .object({
    ...baseListShape,
    healthStatus: textFilter,
    providerStatus: textFilter,
  })
  .strict();

export const notificationViewQuerySchema = z
  .object({
    ...baseListShape,
    status: textFilter,
    channel: textFilter,
    category: textFilter,
  })
  .strict();

export const endpointCoverageViewQuerySchema = z
  .object({
    ...baseListShape,
    module: textFilter,
    riskLevel: textFilter,
    reviewStatus: textFilter,
    releaseReady: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export const auditEventViewQuerySchema = z
  .object({
    ...baseListShape,
    eventType: textFilter,
    actorType: textFilter,
    targetType: textFilter,
  })
  .strict();

export type CustomerViewQueryDto = z.infer<typeof customerViewQuerySchema>;
export type RiskViewQueryDto = z.infer<typeof riskViewQuerySchema>;
export type WorkQueueViewQueryDto = z.infer<typeof workQueueViewQuerySchema>;
export type ProviderHealthViewQueryDto = z.infer<typeof providerHealthViewQuerySchema>;
export type NotificationViewQueryDto = z.infer<typeof notificationViewQuerySchema>;
export type EndpointCoverageViewQueryDto = z.infer<typeof endpointCoverageViewQuerySchema>;
export type AuditEventViewQueryDto = z.infer<typeof auditEventViewQuerySchema>;
