import { z } from 'zod';

const idStringSchema = z.string().trim().regex(/^\d+$/);
const providerCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .transform((value) => (value.toUpperCase() === 'CGIP' ? 'SEGIP' : value.toUpperCase()));
const scenarioSchema = z.string().trim().max(80).optional();
const decisionStageSchema = z
  .string()
  .trim()
  .min(3)
  .max(60)
  .transform((value) => value.toUpperCase());

export const externalConsentSchema = z.object({
  customerId: idStringSchema,
  providerCode: providerCodeSchema.optional(),
  purpose: z.string().trim().min(3).max(100),
  legalTextVersion: z.string().trim().min(1).max(80).default('v1'),
  accepted: z.boolean().default(true),
  channel: z.string().trim().min(2).max(40).default('api'),
  sessionId: idStringSchema.optional(),
  deviceFingerprintSnapshot: z.string().trim().max(180).optional(),
});

export type ExternalConsentDto = z.infer<typeof externalConsentSchema>;

export const externalDataRequestSchema = z.object({
  customerId: idStringSchema.optional(),
  providerCode: providerCodeSchema,
  queryType: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .transform((value) => value.toUpperCase()),
  purpose: z.string().trim().min(3).max(100),
  decisionStage: decisionStageSchema,
  input: z.record(z.string(), z.unknown()).default({}),
  scenario: scenarioSchema,
  approvedByAdminId: idStringSchema.optional(),
  forceRefresh: z.boolean().optional(),
});

export type ExternalDataRequestDto = z.infer<typeof externalDataRequestSchema>;

export const segipVerifySchema = z.object({
  customerId: idStringSchema,
  documentNumber: z.string().trim().min(3).max(30),
  documentComplement: z.string().trim().max(10).optional(),
  documentExtension: z.string().trim().max(10).optional(),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  birthDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  scenario: scenarioSchema,
});

export type SegipVerifyDto = z.infer<typeof segipVerifySchema>;

export const infocenterCheckSchema = z.object({
  customerId: idStringSchema,
  documentNumber: z.string().trim().min(3).max(30).optional(),
  decisionStage: decisionStageSchema.default('MANUAL_REVIEW'),
  approvedByAdminId: idStringSchema.optional(),
  scenario: scenarioSchema,
});

export type InfocenterCheckDto = z.infer<typeof infocenterCheckSchema>;

export const qrPaymentVerifySchema = z.object({
  customerId: idStringSchema,
  amount: z.number().positive(),
  currency: z.string().trim().length(3).default('BOB'),
  paymentReference: z.string().trim().min(3).max(160),
  merchantId: idStringSchema.optional(),
  purchaseId: idStringSchema.optional(),
  paidAt: z.string().trim().max(40).optional(),
  scenario: scenarioSchema,
});
export type QrPaymentVerifyDto = z.infer<typeof qrPaymentVerifySchema>;

export const bankTransferVerifySchema = z.object({
  customerId: idStringSchema,
  amount: z.number().positive(),
  currency: z.string().trim().length(3).default('BOB'),
  transferReference: z.string().trim().min(3).max(160),
  bankCode: z.string().trim().min(2).max(80).default('BANKING_GENERIC'),
  accountHolderName: z.string().trim().max(180).optional(),
  accountNumberHash: z.string().trim().max(128).optional(),
  scenario: scenarioSchema,
});
export type BankTransferVerifyDto = z.infer<typeof bankTransferVerifySchema>;

export const telcoPhoneTrustSchema = z.object({
  customerId: idStringSchema,
  phoneNumber: z.string().trim().min(8).max(30),
  documentNumber: z.string().trim().min(3).max(30).optional(),
  operatorCode: z.string().trim().max(40).optional(),
  scenario: scenarioSchema,
});
export type TelcoPhoneTrustDto = z.infer<typeof telcoPhoneTrustSchema>;

export const whatsappVerificationStartSchema = z.object({
  customerId: idStringSchema,
  phoneNumber: z.string().trim().min(8).max(30),
  channel: z.literal('whatsapp').default('whatsapp'),
  scenario: scenarioSchema,
});
export type WhatsappVerificationStartDto = z.infer<typeof whatsappVerificationStartSchema>;

export const whatsappVerificationConfirmSchema = z.object({
  customerId: idStringSchema,
  phoneNumber: z.string().trim().min(8).max(30),
  otpCode: z.string().trim().min(4).max(12),
  verificationRef: z.string().trim().max(120).optional(),
  scenario: scenarioSchema,
});
export type WhatsappVerificationConfirmDto = z.infer<typeof whatsappVerificationConfirmSchema>;

export const digitalTrustCheckSchema = z.object({
  customerId: idStringSchema,
  email: z.string().trim().email().optional(),
  phoneNumber: z.string().trim().min(8).max(30).optional(),
  ipAddress: z.string().trim().max(80).optional(),
  deviceFingerprint: z.string().trim().max(180).optional(),
  scenario: scenarioSchema,
});
export type DigitalTrustCheckDto = z.infer<typeof digitalTrustCheckSchema>;

export const facebookConnectUrlQuerySchema = z.object({ customerId: idStringSchema });
export type FacebookConnectUrlQueryDto = z.infer<typeof facebookConnectUrlQuerySchema>;

export const facebookCallbackSchema = z.object({
  customerId: idStringSchema,
  code: z.string().trim().min(3).max(500).optional(),
  state: z.string().trim().max(500).optional(),
  scenario: scenarioSchema,
});
export type FacebookCallbackDto = z.infer<typeof facebookCallbackSchema>;

export const providerCostPolicyPatchSchema = z.object({
  unitCostAmount: z.number().nonnegative().optional(),
  currency: z.string().trim().length(3).optional(),
  costTier: z.enum(['FREE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  maxQueriesPerUserPerDay: z.number().int().positive().nullable().optional(),
  maxQueriesPerUserPerMonth: z.number().int().positive().nullable().optional(),
  maxQueriesGlobalPerDay: z.number().int().positive().nullable().optional(),
  allowedDecisionStagesJson: z.array(z.string().trim().min(2).max(80)).optional(),
  requiresManualApproval: z.boolean().optional(),
  requiresAdminRole: z.boolean().optional(),
  blockByDefault: z.boolean().optional(),
  cacheTtlSeconds: z.number().int().nonnegative().nullable().optional(),
  featureTtlSeconds: z.number().int().nonnegative().nullable().optional(),
  retryMaxAttempts: z.number().int().nonnegative().nullable().optional(),
  retryBackoffSeconds: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
});
export type ProviderCostPolicyPatchDto = z.infer<typeof providerCostPolicyPatchSchema>;

export const providerCodeParamsSchema = z.object({ providerCode: providerCodeSchema });
export type ProviderCodeParamsDto = z.infer<typeof providerCodeParamsSchema>;

export const requestIdParamsSchema = z.object({ requestId: idStringSchema });
export type RequestIdParamsDto = z.infer<typeof requestIdParamsSchema>;

export const consentIdParamsSchema = z.object({ consentId: idStringSchema });
export type ConsentIdParamsDto = z.infer<typeof consentIdParamsSchema>;

export const customerIdParamsSchema = z.object({ customerId: idStringSchema });
export type CustomerIdParamsDto = z.infer<typeof customerIdParamsSchema>;

export const approveProviderRequestSchema = z.object({
  approvedByAdminId: idStringSchema.optional(),
  approvalReason: z.string().trim().max(240).optional(),
});
export type ApproveProviderRequestDto = z.infer<typeof approveProviderRequestSchema>;

export const providerRuntimePatchSchema = z.object({
  defaultMode: z.enum(['mock_local', 'mock_server', 'sandbox', 'production', 'disabled']).optional(),
  providerStatus: z.enum(['ACTIVE', 'DISABLED', 'MOCK_ONLY', 'SANDBOX_ONLY']).optional(),
  isActive: z.boolean().optional(),
  confirmProductionReady: z.boolean().default(false),
  reason: z.string().trim().min(3).max(240).optional(),
});
export type ProviderRuntimePatchDto = z.infer<typeof providerRuntimePatchSchema>;

export const providerUsageQuerySchema = z.object({
  providerCode: providerCodeSchema.optional(),
  days: z.coerce.number().int().positive().max(366).default(30),
});
export type ProviderUsageQueryDto = z.infer<typeof providerUsageQuerySchema>;

export const retentionPreviewQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(3650).default(90),
  limit: z.coerce.number().int().positive().max(500).default(100),
});
export type RetentionPreviewQueryDto = z.infer<typeof retentionPreviewQuerySchema>;

export const sanitizationAuditQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
});
export type SanitizationAuditQueryDto = z.infer<typeof sanitizationAuditQuerySchema>;

export const productionGateQuerySchema = z.object({
  providerCode: providerCodeSchema.optional(),
  strict: z.coerce.boolean().default(true),
});
export type ProductionGateQueryDto = z.infer<typeof productionGateQuerySchema>;

export const providerSlaQuerySchema = z.object({
  providerCode: providerCodeSchema.optional(),
  days: z.coerce.number().int().positive().max(366).default(30),
});
export type ProviderSlaQueryDto = z.infer<typeof providerSlaQuerySchema>;

export const idempotencyAuditQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(366).default(30),
  limit: z.coerce.number().int().positive().max(10000).default(5000),
});
export type IdempotencyAuditQueryDto = z.infer<typeof idempotencyAuditQuerySchema>;

export const decisionPackageQuerySchema = z.object({
  includeRawResponses: z.coerce.boolean().default(false),
  featureMaxAgeHours: z.coerce.number().int().positive().max(8760).optional(),
});
export type DecisionPackageQueryDto = z.infer<typeof decisionPackageQuerySchema>;

export const retryRequestSchema = z.object({
  providerCode: providerCodeSchema.optional(),
  queryType: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .transform((value) => value.toUpperCase())
    .optional(),
  purpose: z.string().trim().min(3).max(100).optional(),
  decisionStage: decisionStageSchema.optional(),
  customerId: idStringSchema.optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  scenario: scenarioSchema,
  approvedByAdminId: idStringSchema.optional(),
});
export type RetryRequestDto = z.infer<typeof retryRequestSchema>;
