import { z } from 'zod';

export const customerRiskParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export const riskAssessmentParamsSchema = z.object({
  riskAssessmentRunId: z.string().regex(/^[1-9][0-9]*$/),
});

export const createRiskAssessmentSchema = z.object({
  assessmentType: z.enum(['onboarding_initial', 'behavior_update', 'manual_recheck', 'fraud_recheck']),
  channel: z.enum(['mobile_app', 'operations_panel', 'system']),
  sessionId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  deviceId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  requestedLimitContext: z
    .object({
      purpose: z.string().trim().min(1).max(120),
    })
    .optional(),
});

export type CustomerRiskParamsDto = z.infer<typeof customerRiskParamsSchema>;
export type RiskAssessmentParamsDto = z.infer<typeof riskAssessmentParamsSchema>;
export type CreateRiskAssessmentDto = z.infer<typeof createRiskAssessmentSchema>;
