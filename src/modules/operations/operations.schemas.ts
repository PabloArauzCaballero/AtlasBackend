import { z } from 'zod';

export const listManualReviewCasesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().trim().min(1).max(40).optional(),
  customerId: z.string().regex(/^[1-9][0-9]*$/).optional(),
});

export const listFraudCasesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().trim().min(1).max(40).optional(),
  customerId: z.string().regex(/^[1-9][0-9]*$/).optional(),
});

export type ListManualReviewCasesQueryDto = z.infer<typeof listManualReviewCasesQuerySchema>;
export type ListFraudCasesQueryDto = z.infer<typeof listFraudCasesQuerySchema>;
