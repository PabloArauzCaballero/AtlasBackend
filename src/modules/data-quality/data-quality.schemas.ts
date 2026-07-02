import { z } from 'zod';

export const dataQualityQuerySchema = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  severity: z.string().trim().min(1).max(40).optional(),
  entityType: z.string().trim().min(1).max(120).optional(),
  customerId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const dataQualityIssueParamsSchema = z.object({ issueId: z.string().regex(/^[1-9][0-9]*$/) });

export const resolveDataQualityIssueSchema = z.object({
  resolution: z.enum(['resolved', 'ignored']),
  reasonCode: z.string().trim().min(1).max(120),
  notes: z.string().trim().min(1).max(2000),
});

export type DataQualityQueryDto = z.infer<typeof dataQualityQuerySchema>;
export type DataQualityIssueParamsDto = z.infer<typeof dataQualityIssueParamsSchema>;
export type ResolveDataQualityIssueDto = z.infer<typeof resolveDataQualityIssueSchema>;
