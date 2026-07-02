import { z } from 'zod';

export const runJobHeadersSchema = z.object({
  tenantId: z.string().regex(/^[1-9][0-9]*$/),
  idempotencyKey: z.string().min(8),
});

export const expireStaleSessionsSchema = z.object({
  maxIdleMinutes: z.number().int().positive().max(43_200).default(120),
  dryRun: z.boolean().default(true),
});

export const processOutboxSchema = z.object({
  limit: z.number().int().positive().max(500).default(50),
  dryRun: z.boolean().default(true),
});

export const processEventsSchema = z.object({
  limit: z.number().int().positive().max(500).default(50),
  dryRun: z.boolean().default(true),
});

export const applyRetentionPoliciesSchema = z.object({
  policyCode: z.string().min(1).max(120).optional(),
  dryRun: z.boolean().default(true),
});

export const recalculateDataQualitySchema = z.object({
  customerId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  dryRun: z.boolean().default(true),
});

export type ExpireStaleSessionsDto = z.infer<typeof expireStaleSessionsSchema>;
export type ProcessOutboxDto = z.infer<typeof processOutboxSchema>;
export type ProcessEventsDto = z.infer<typeof processEventsSchema>;
export type ApplyRetentionPoliciesDto = z.infer<typeof applyRetentionPoliciesSchema>;
export type RecalculateDataQualityDto = z.infer<typeof recalculateDataQualitySchema>;
