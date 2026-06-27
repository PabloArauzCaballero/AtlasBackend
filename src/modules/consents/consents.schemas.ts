import { z } from 'zod';

export const listActiveConsentDocumentsQuerySchema = z.object({
  language: z.string().trim().min(2).max(10).default('es'),
  documentCode: z.string().trim().min(1).max(80).optional(),
});

export const createCustomerConsentSchema = z.object({
  consentDocumentId: z.string().regex(/^[1-9][0-9]*$/),
  purposeCode: z.string().trim().min(1).max(80),
  granted: z.boolean(),
  channel: z.string().trim().min(1).max(40).default('mobile_app'),
  sessionId: z.string().regex(/^[1-9][0-9]*$/).optional(),
  deviceFingerprintSnapshot: z.string().trim().min(32).max(128).optional(),
  userAgent: z.string().trim().max(500).optional(),
  evidenceSnapshotUrl: z.string().trim().url().max(1000).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const consentCustomerIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export type ListActiveConsentDocumentsQueryDto = z.infer<typeof listActiveConsentDocumentsQuerySchema>;
export type CreateCustomerConsentDto = z.infer<typeof createCustomerConsentSchema>;
export type ConsentCustomerIdParamsDto = z.infer<typeof consentCustomerIdParamsSchema>;
