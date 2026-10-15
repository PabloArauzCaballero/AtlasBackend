/**
 * @file Esquemas Zod: conjuntos de reglas de riesgo y políticas de gobierno de datos de los catálogos.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import { z } from 'zod';

const positiveId = z.string().regex(/^[1-9][0-9]*$/, 'Debe ser un entero positivo representado como texto.');
const code = z
  .string()
  .min(2)
  .max(140)
  .regex(/^[a-zA-Z0-9_.:-]+$/, 'Código inválido.');
const isoDate = z.string().datetime();
const jsonRecord = z.record(z.string(), z.unknown());

export const createRiskRulesetVersionSchema = z.object({
  modelVersion: z.object({
    modelCode: code,
    versionCode: z.string().min(2).max(80),
    modelType: z.string().min(2).max(60).optional().default('rules'),
    assessmentType: z.string().min(2).max(80),
    status: z.enum(['draft', 'inactive']).optional().default('draft'),
    artifactUrl: z.string().url().optional(),
    artifactHash: z.string().max(128).optional(),
  }),
  ruleset: z.object({
    rulesetCode: code,
    versionCode: z.string().min(2).max(80),
    assessmentType: z.string().min(2).max(80),
    status: z.enum(['draft', 'inactive']).optional().default('draft'),
  }),
  rules: z
    .array(
      z.object({
        ruleCode: code,
        ruleName: z.string().min(1).max(180),
        riskDimension: z.string().min(2).max(60),
        ruleType: z.string().min(2).max(60),
        severity: z.string().min(2).max(40),
        expressionJson: jsonRecord,
        actionCode: z.string().min(2).max(80),
        reasonCode: z.string().min(2).max(100),
        isHardStop: z.boolean().optional().default(false),
      }),
    )
    .min(1)
    .max(500),
  riskSignalSeeds: z
    .array(
      z.object({
        signalCode: code,
        signalName: z.string().min(1).max(180),
        signalType: z.string().min(2).max(60),
        sourceEntity: z.string().min(2).max(120),
        targetDefinitionCode: code.optional(),
        riskDimension: z.string().min(2).max(60).optional(),
        buildPhase: z.string().min(2).max(40).optional(),
        priority: z.string().min(2).max(40).optional(),
        expectedDirection: z.string().min(2).max(40).optional(),
        exampleValue: jsonRecord.optional().default({}),
        rationale: z.string().max(2000).optional(),
      }),
    )
    .max(500)
    .optional()
    .default([]),
});
export type CreateRiskRulesetVersionDto = z.infer<typeof createRiskRulesetVersionSchema>;

export const activateRiskRulesetVersionSchema = z.object({
  activationReason: z.string().min(5).max(3000),
  effectiveFrom: isoDate.optional(),
});
export type ActivateRiskRulesetVersionDto = z.infer<typeof activateRiskRulesetVersionSchema>;

export const dataGovernancePolicyPackageSchema = z.object({
  privacyPurposes: z
    .array(
      z.object({
        purposeCode: code,
        purposeName: z.string().min(1).max(180),
        legalBasis: z.string().min(2).max(160).optional(),
        description: z.string().max(2000).optional(),
        requiresExplicitConsent: z.boolean().optional().default(false),
      }),
    )
    .max(200)
    .optional()
    .default([]),
  retentionPolicies: z
    .array(
      z.object({
        policyCode: code,
        appliesTo: z.string().min(2).max(80),
        retentionDays: z.number().int().positive(),
        postRetentionAction: z.string().min(2).max(40),
        legalBasis: z.string().min(2).max(180).optional(),
        description: z.string().max(2000).optional(),
      }),
    )
    .max(200)
    .optional()
    .default([]),
  dataProviders: z
    .array(
      z.object({
        providerCode: code,
        providerName: z.string().min(1).max(180),
        providerType: z.string().min(2).max(60),
        reliabilityScore: z
          .string()
          .regex(/^\d{1,3}(\.\d{1,2})?$/)
          .optional(),
        supportsRetroData: z.boolean().optional().default(false),
        defaultRetentionPolicyId: positiveId.optional(),
      }),
    )
    .max(200)
    .optional()
    .default([]),
  classificationPolicies: z
    .array(
      z.object({
        classificationCode: code,
        classificationName: z.string().min(1).max(160),
        sensitivityLevel: z.string().min(2).max(40),
        allowedStorageModes: jsonRecord.optional().default({}),
        defaultStorageMode: z.string().min(2).max(40).optional(),
        defaultRetentionPolicyId: positiveId.optional(),
        encryptionRequired: z.boolean().optional().default(false),
        hashingRequired: z.boolean().optional().default(false),
        rawStorageAllowed: z.boolean().optional().default(false),
        description: z.string().max(2000).optional(),
      }),
    )
    .max(200)
    .optional()
    .default([]),
  sensitiveFieldRules: z
    .array(
      z.object({
        tableName: z.string().min(2).max(120),
        fieldName: z.string().min(2).max(120),
        classificationCode: code,
        storageMode: z.string().min(2).max(40),
        searchStrategy: z.string().min(2).max(40).optional(),
        maskingStrategy: z.string().min(2).max(40).optional(),
        accessPolicyCode: code.optional(),
        retentionPolicyId: positiveId.optional(),
      }),
    )
    .max(500)
    .optional()
    .default([]),
  dataQualityRules: z
    .array(
      z.object({
        ruleCode: code,
        ruleName: z.string().min(1).max(180),
        targetTable: z.string().min(2).max(120),
        targetField: z.string().min(2).max(120).optional(),
        severity: z.string().min(2).max(40),
        expressionJson: jsonRecord,
        expectedAction: z.string().min(2).max(80),
        buildPhase: z.string().min(2).max(40).optional(),
      }),
    )
    .max(500)
    .optional()
    .default([]),
});
export type DataGovernancePolicyPackageDto = z.infer<typeof dataGovernancePolicyPackageSchema>;
