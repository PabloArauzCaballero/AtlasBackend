import { z } from 'zod';

export const listActiveConsentDocumentsQuerySchema = z.object({
  language: z.string().trim().min(2).max(10).default('es'),
  purposeCode: z.string().trim().min(1).max(80).optional(),
  // BLOCKED: consent_documents table has no channel or countryCode columns.
  // These params are accepted for forward compatibility but not applied to the DB query.
});

export type ListActiveConsentDocumentsQueryDto = z.infer<typeof listActiveConsentDocumentsQuerySchema>;
