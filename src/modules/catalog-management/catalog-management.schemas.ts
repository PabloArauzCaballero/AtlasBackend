import { z } from 'zod';

const positiveId = z.string().regex(/^[1-9][0-9]*$/, 'Debe ser un entero positivo representado como texto.');
const code = z
  .string()
  .min(2)
  .max(140)
  .regex(/^[a-zA-Z0-9_.:-]+$/, 'Código inválido.');
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser fecha YYYY-MM-DD.');
const isoDate = z.string().datetime();
const jsonRecord = z.record(z.string(), z.unknown());

export const catalogCodeParamsSchema = z.object({ catalogCode: code });
export const catalogVersionParamsSchema = z.object({ catalogCode: code, versionId: positiveId });
export const rulesetVersionParamsSchema = z.object({ rulesetVersionId: positiveId });

export type CatalogCodeParamsDto = z.infer<typeof catalogCodeParamsSchema>;
export type CatalogVersionParamsDto = z.infer<typeof catalogVersionParamsSchema>;
export type RulesetVersionParamsDto = z.infer<typeof rulesetVersionParamsSchema>;

export const listCatalogsQuerySchema = z.object({
  domain: z.string().min(2).max(80).optional(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'published', 'retired', 'all']).optional().default('all'),
  active: z.enum(['true', 'false', 'all']).optional().default('all'),
});
export type ListCatalogsQueryDto = z.infer<typeof listCatalogsQuerySchema>;

const aliasSchema = z.object({
  aliasValue: z.string().min(1).max(220),
  aliasType: z.string().min(2).max(60).default('common_name'),
  confidenceScore: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/)
    .optional(),
});

const riskMappingSchema = z.object({
  riskDimension: z.string().min(2).max(60),
  riskBand: z.string().min(2).max(40),
  scorePointsSuggested: z
    .string()
    .regex(/^-?\d{1,6}(\.\d{1,2})?$/)
    .optional(),
  reasonCode: z.string().min(2).max(100),
  explanation: z.string().max(2000).optional(),
  modelUsage: z.string().min(2).max(80).optional(),
  validFrom: dateOnly.optional(),
  validUntil: dateOnly.optional(),
});

const catalogItemSchema = z.object({
  itemCode: code,
  itemName: z.string().min(1).max(220),
  itemType: z.string().min(2).max(80),
  sourceCode: code.optional(),
  confidenceScore: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/)
    .optional(),
  attributes: jsonRecord.optional().default({}),
  aliases: z.array(aliasSchema).max(50).optional().default([]),
  riskMappings: z.array(riskMappingSchema).max(50).optional().default([]),
});

export const createCatalogVersionSchema = z.object({
  versionCode: z.string().min(2).max(60),
  validFrom: dateOnly.optional(),
  validUntil: dateOnly.optional(),
  notes: z.string().max(4000).optional(),
  items: z.array(catalogItemSchema).min(1).max(500),
});
export type CreateCatalogVersionDto = z.infer<typeof createCatalogVersionSchema>;

export const submitCatalogVersionSchema = z.object({
  notes: z.string().min(3).max(2000),
});
export type SubmitCatalogVersionDto = z.infer<typeof submitCatalogVersionSchema>;

export const catalogDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'publish', 'retire']),
  decisionReason: z.string().min(5).max(3000),
  validFrom: dateOnly.optional(),
  validUntil: dateOnly.optional(),
});
export type CatalogDecisionDto = z.infer<typeof catalogDecisionSchema>;

export const catalogIngestionSchema = z.object({
  catalogCode: code,
  sourceType: z.string().min(2).max(60),
  sourceName: z.string().min(2).max(160),
  sourceCode: code.optional(),
  items: z
    .array(
      z.object({
        rawValue: z.string().min(1).max(500),
        normalizedValue: code.optional(),
        itemType: z.string().min(2).max(80),
        confidenceScore: z
          .string()
          .regex(/^\d{1,3}(\.\d{1,2})?$/)
          .optional(),
        rawPayload: jsonRecord.optional().default({}),
        aiSuggested: z.boolean().optional().default(false),
      }),
    )
    .min(1)
    .max(1000),
});
export type CatalogIngestionDto = z.infer<typeof catalogIngestionSchema>;

export const stagingDecisionBatchSchema = z.object({
  targetCatalogVersionId: positiveId,
  decisions: z
    .array(
      z.object({
        stagingItemId: positiveId,
        decision: z.enum(['approve', 'reject']),
        itemCode: code.optional(),
        itemName: z.string().min(1).max(220).optional(),
        itemType: z.string().min(2).max(80).optional(),
        decisionReason: z.string().min(5).max(2000),
        aliases: z.array(aliasSchema).max(50).optional().default([]),
        riskMappings: z.array(riskMappingSchema).max(50).optional().default([]),
      }),
    )
    .min(1)
    .max(500),
});
export type StagingDecisionBatchDto = z.infer<typeof stagingDecisionBatchSchema>;

export const definitionsQuerySchema = z.object({
  type: z.enum(['observation', 'event', 'attribute', 'feature', 'all']).optional().default('all'),
  status: z.enum(['active', 'inactive', 'all']).optional().default('all'),
  domain: z.string().min(2).max(80).optional(),
});
export type DefinitionsQueryDto = z.infer<typeof definitionsQuerySchema>;

const definitionBase = z.object({
  description: z.string().max(2000).optional(),
  dataType: z.string().min(2).max(40).optional(),
  riskDimension: z.string().min(2).max(60).optional(),
  buildPhase: z.string().min(2).max(40).optional(),
  dataClassificationCode: z.string().min(2).max(80).optional(),
  requiresConsent: z.boolean().optional(),
  isSensitive: z.boolean().optional(),
  allowedForCreditDecision: z.boolean().optional(),
  allowedForFraudDecision: z.boolean().optional(),
  legalReviewStatus: z.string().min(2).max(40).optional(),
  fairnessReviewRequired: z.boolean().optional(),
  retentionPolicyId: positiveId.optional(),
});

export const definitionsPackageSchema = z.object({
  domain: z.string().min(2).max(80),
  definitions: z.object({
    events: z
      .array(
        definitionBase.extend({
          eventCode: code,
          eventName: z.string().min(1).max(180),
          eventFamily: z.string().min(2).max(80).optional(),
          sourcePackage: z.string().min(2).max(120).optional(),
          targetTables: z.array(z.string().min(2).max(120)).optional().default([]),
          expectedPayloadSchema: jsonRecord.optional().default({}),
          isHighVolume: z.boolean().optional(),
        }),
      )
      .max(300)
      .optional()
      .default([]),
    observations: z
      .array(
        definitionBase.extend({
          observationCode: code,
          observationName: z.string().min(1).max(180),
          sourceGroup: z.string().min(2).max(60).optional(),
          expectedAvailabilityStage: z.string().min(2).max(40).optional(),
        }),
      )
      .max(300)
      .optional()
      .default([]),
    attributes: z
      .array(
        definitionBase.extend({
          attributeCode: code,
          attributeName: z.string().min(1).max(180),
          entityScope: z.string().min(2).max(60).optional(),
          sourceType: z.string().min(2).max(60).optional(),
          availabilityStage: z.string().min(2).max(40).optional(),
          isModelCandidate: z.boolean().optional(),
        }),
      )
      .max(300)
      .optional()
      .default([]),
    features: z
      .array(
        definitionBase.extend({
          featureCode: code,
          featureName: z.string().min(1).max(180),
          featureFamily: z.string().min(2).max(80).optional(),
          availabilityTier: z.string().min(2).max(40).optional(),
          calculationKind: z.string().min(2).max(60).optional(),
          defaultMissingStrategy: z.string().min(2).max(80).optional(),
          isModelInput: z.boolean().optional(),
          isPolicyRuleInput: z.boolean().optional(),
          ownerTeam: z.string().min(2).max(80).optional(),
        }),
      )
      .max(300)
      .optional()
      .default([]),
  }),
});
export type DefinitionsPackageDto = z.infer<typeof definitionsPackageSchema>;

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
