import { z } from 'zod';

const positiveId = z.string().regex(/^[1-9][0-9]*$/);
const optionalCsv = z.string().trim().min(1).max(200).optional();

export const systemsListQuerySchema = z.object({
  module: z.string().trim().min(1).max(120).optional(),
  backendService: z.string().trim().min(1).max(120).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  reviewStatus: z.enum(['AUTO_DETECTED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const systemsEndpointParamsSchema = z.object({ endpointId: positiveId });
export const systemsToolParamsSchema = z.object({ toolId: positiveId });
export const systemsEntityParamsSchema = z.object({ entityId: positiveId });
export const systemsTableImpactParamsSchema = z.object({
  schemaName: z.string().trim().min(1).max(120),
  tableName: z.string().trim().min(1).max(180),
});
export const systemsSuiteParamsSchema = z.object({ suiteId: positiveId });
export const systemsRunParamsSchema = z.object({ runId: positiveId });
export const systemsDataImpactParamsSchema = z.object({ impactId: positiveId });
export const systemsFieldImpactParamsSchema = z.object({ fieldImpactId: positiveId });
export const systemsDomainParamsSchema = z.object({
  domainCode: z.string().trim().min(1).max(120),
});
export const systemsToolRequirementParamsSchema = z.object({ requirementId: positiveId });
export const systemsStressProfileParamsSchema = z.object({ profileId: positiveId });
export const systemsRequestParamsSchema = z.object({ requestId: z.string().trim().min(1).max(120) });

export const systemsTestStepParamsSchema = z.object({ suiteId: positiveId, stepId: positiveId });

const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const suiteTypeSchema = z.enum(['INTEGRATION', 'SMOKE', 'REGRESSION', 'E2E_API', 'LOAD']);
const environmentSchema = z.enum(['LOCAL', 'STAGING', 'PRODUCTION_READONLY']);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const pathTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(1200)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'), {
    message: 'pathTemplate debe ser una ruta relativa al host permitido e iniciar con un solo /.',
  });

export const createTestSuiteSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(180)
    .regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(3).max(220),
  description: z.string().trim().max(4000).optional(),
  module: z.string().trim().min(2).max(120),
  suiteType: suiteTypeSchema.default('INTEGRATION'),
  environmentScope: z.array(environmentSchema).min(1).max(3).default(['LOCAL', 'STAGING']),
  isEnabled: z.coerce.boolean().default(true),
  requiresSeedData: z.coerce.boolean().default(true),
  isSafeForProduction: z.coerce.boolean().default(false),
  requiresDestructivePermission: z.coerce.boolean().optional(),
});

// No se construye como `createTestSuiteSchema.partial()`: Zod re-aplica `.default()` de cada
// campo incluso después de `.partial()`, así que un PATCH parcial (o vacío) llegaría con
// suiteType/environmentScope/isEnabled/requiresSeedData/isSafeForProduction ya rellenados a sus
// valores de creación — el refine de "al menos un campo" nunca se dispara, y
// SystemsTestSuiteAdminRepository.updateSuite (que escribe todo campo !== undefined) los
// sobrescribiría en silencio en cualquier suite existente. Se declaran los campos opcionales
// explícitamente, sin `.default()`, para que un campo ausente siga siendo `undefined`.
export const updateTestSuiteSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(180)
      .regex(/^[A-Z0-9_]+$/)
      .optional(),
    name: z.string().trim().min(3).max(220).optional(),
    description: z.string().trim().max(4000).optional(),
    module: z.string().trim().min(2).max(120).optional(),
    suiteType: suiteTypeSchema.optional(),
    environmentScope: z.array(environmentSchema).min(1).max(3).optional(),
    isEnabled: z.coerce.boolean().optional(),
    requiresSeedData: z.coerce.boolean().optional(),
    isSafeForProduction: z.coerce.boolean().optional(),
    requiresDestructivePermission: z.coerce.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar.',
  });

export const createTestStepSchema = z.object({
  endpointId: positiveId.optional().nullable(),
  stepOrder: z.coerce.number().int().positive().max(500),
  name: z.string().trim().min(3).max(220),
  inputMode: z.enum(['DEFAULT', 'CONFIGURABLE', 'GENERATED', 'FROM_PREVIOUS_STEP']).default('DEFAULT'),
  method: httpMethodSchema,
  pathTemplate: pathTemplateSchema,
  defaultHeaders: jsonObjectSchema.default({}),
  defaultPayload: jsonObjectSchema.default({}),
  configSchema: jsonObjectSchema.default({}),
  extractors: jsonObjectSchema.default({}),
  assertions: jsonObjectSchema.default({ expectedStatusCodes: [200, 201] }),
  continueOnFailure: z.coerce.boolean().default(false),
  cleanupRequired: z.coerce.boolean().default(false),
});

// Mismo problema y mismo fix que `updateTestSuiteSchema` (ver comentario arriba): campos
// opcionales explícitos, sin `.default()`, para que `SystemsTestSuiteAdminRepository.updateStep`
// no reciba de vuelta assertions/extractors/headers/payload reseteados a su default de creación
// en cada PATCH parcial.
export const updateTestStepSchema = z
  .object({
    endpointId: positiveId.optional().nullable(),
    stepOrder: z.coerce.number().int().positive().max(500).optional(),
    name: z.string().trim().min(3).max(220).optional(),
    inputMode: z.enum(['DEFAULT', 'CONFIGURABLE', 'GENERATED', 'FROM_PREVIOUS_STEP']).optional(),
    method: httpMethodSchema.optional(),
    pathTemplate: pathTemplateSchema.optional(),
    defaultHeaders: jsonObjectSchema.optional(),
    defaultPayload: jsonObjectSchema.optional(),
    configSchema: jsonObjectSchema.optional(),
    extractors: jsonObjectSchema.optional(),
    assertions: jsonObjectSchema.optional(),
    continueOnFailure: z.coerce.boolean().optional(),
    cleanupRequired: z.coerce.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar.',
  });

export const reorderTestStepsSchema = z.object({
  steps: z
    .array(
      z.object({
        stepId: positiveId,
        stepOrder: z.coerce.number().int().positive().max(500),
      }),
    )
    .min(1)
    .max(500),
});

export const inferToolRequirementsSchema = z.object({
  persist: z.coerce.boolean().default(true),
});

export const queueStressRunSchema = z.object({
  environment: environmentSchema.default('LOCAL'),
  dryRun: z.coerce.boolean().default(true),
  baseUrl: z.string().url().optional(),
  approvalTicket: z.string().trim().min(3).max(160).optional(),
  config: jsonObjectSchema.default({}),
  headers: z.record(z.string(), z.string()).default({}),
});

export const systemsActionLogQuerySchema = z.object({
  endpointId: positiveId.optional(),
  requestId: z.string().trim().min(1).max(120).optional(),
  correlationId: z.string().trim().min(1).max(120).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']).optional(),
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  actorType: z.string().trim().min(1).max(80).optional(),
  module: z.string().trim().min(1).max(120).optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  containsPii: z.coerce.boolean().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const trafficLatencyQuerySchema = z.object({
  windowHours: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .default(24),
});

export const trafficLatencyTimeseriesQuerySchema = z.object({
  windowHours: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 7)
    .default(24),
});

export const reviewDecisionSchema = z.object({
  reviewStatus: z.enum(['NEEDS_REVIEW', 'APPROVED', 'REJECTED']),
  confidenceLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const systemsColumnParamsSchema = z.object({ columnId: positiveId });

export const systemsReviewQueueSchema = z.object({
  type: z
    .enum(['all', 'endpoints', 'data_entities', 'data_impacts', 'field_impacts', 'data_column_impacts', 'tool_requirements'])
    .default('all'),
  module: z.string().trim().min(1).max(120).optional(),
  reviewStatus: z.enum(['AUTO_DETECTED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED']).default('NEEDS_REVIEW'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const systemsStressProfileQuerySchema = z.object({
  endpointId: positiveId.optional(),
  status: z.string().trim().min(1).max(40).optional(),
  enabled: z.coerce.boolean().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const upsertStressProfileSchema = z.object({
  endpointId: positiveId,
  code: z
    .string()
    .trim()
    .min(3)
    .max(180)
    .regex(/^[A-Z0-9_]+$/)
    .optional(),
  name: z.string().trim().min(3).max(220),
  targetRps: z.coerce.number().int().min(1).max(10000),
  durationSeconds: z.coerce.number().int().min(5).max(86400),
  concurrency: z.coerce.number().int().min(1).max(5000),
  environmentScope: z
    .array(z.enum(['LOCAL', 'STAGING', 'PRODUCTION_READONLY']))
    .min(1)
    .max(3)
    .default(['LOCAL', 'STAGING']),
  maxErrorRate: z.coerce.number().min(0).max(1).default(0.01),
  maxP95Ms: z.coerce.number().int().min(1).max(300000).default(1000),
  isEnabled: z.coerce.boolean().default(true),
  requiresApproval: z.coerce.boolean().default(true),
  status: z.enum(['ACTIVE', 'DISABLED', 'NEEDS_REVIEW', 'DEPRECATED']).default('ACTIVE'),
  notes: z.string().trim().max(2000).optional(),
});

export const runTestSuiteSchema = z.object({
  environment: z.enum(['LOCAL', 'STAGING', 'PRODUCTION_READONLY']).default('LOCAL'),
  dryRun: z.coerce.boolean().default(true),
  baseUrl: z.string().url().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.coerce.number().int().min(100).max(60000).default(10000),
});

export const discoverEndpointsSchema = z.object({
  mode: z.enum(['SOURCE_SCAN']).default('SOURCE_SCAN'),
  persist: z.coerce.boolean().default(true),
});

export const catalogSeedRefreshSchema = z.object({
  includeTools: z.coerce.boolean().default(true),
  includeDataEntities: z.coerce.boolean().default(true),
  includeEndpointSeeds: z.coerce.boolean().default(true),
});

export const updateDataEntityMetadataSchema = z
  .object({
    businessPurpose: z.string().trim().min(3).max(4000).optional(),
    dataOwner: z.string().trim().min(2).max(120).optional(),
    containsPii: z.boolean().optional(),
    containsFinancialData: z.boolean().optional(),
    containsRiskData: z.boolean().optional(),
    containsLegalData: z.boolean().optional(),
    containsDeviceData: z.boolean().optional(),
    containsLocationData: z.boolean().optional(),
    isAuditCritical: z.boolean().optional(),
    retentionPolicyCode: z.string().trim().min(2).max(120).nullable().optional(),
    status: z.enum(['ACTIVE', 'DISABLED', 'DEPRECATED', 'DEPRECATED_CANDIDATE']).optional(),
    reviewStatus: z.enum(['AUTO_DETECTED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Debe enviar al menos un campo de metadata.' });

export const systemsRunsQuerySchema = z.object({
  suiteId: positiveId.optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED']).optional(),
  environment: z.enum(['LOCAL', 'STAGING', 'PRODUCTION_READONLY']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const systemsSuiteQuerySchema = z.object({
  module: z.string().trim().min(1).max(120).optional(),
  suiteType: optionalCsv,
  enabled: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type SystemsTestStepParamsDto = z.infer<typeof systemsTestStepParamsSchema>;
export type CreateTestSuiteDto = z.infer<typeof createTestSuiteSchema>;
export type UpdateTestSuiteDto = z.infer<typeof updateTestSuiteSchema>;
export type CreateTestStepDto = z.infer<typeof createTestStepSchema>;
export type UpdateTestStepDto = z.infer<typeof updateTestStepSchema>;
export type ReorderTestStepsDto = z.infer<typeof reorderTestStepsSchema>;
export type InferToolRequirementsDto = z.infer<typeof inferToolRequirementsSchema>;
export type QueueStressRunDto = z.infer<typeof queueStressRunSchema>;
export type SystemsListQueryDto = z.infer<typeof systemsListQuerySchema>;
export type SystemsEndpointParamsDto = z.infer<typeof systemsEndpointParamsSchema>;
export type SystemsToolParamsDto = z.infer<typeof systemsToolParamsSchema>;
export type SystemsEntityParamsDto = z.infer<typeof systemsEntityParamsSchema>;
export type SystemsTableImpactParamsDto = z.infer<typeof systemsTableImpactParamsSchema>;
export type SystemsSuiteParamsDto = z.infer<typeof systemsSuiteParamsSchema>;
export type SystemsRunParamsDto = z.infer<typeof systemsRunParamsSchema>;
export type SystemsDataImpactParamsDto = z.infer<typeof systemsDataImpactParamsSchema>;
export type SystemsFieldImpactParamsDto = z.infer<typeof systemsFieldImpactParamsSchema>;
export type SystemsDomainParamsDto = z.infer<typeof systemsDomainParamsSchema>;
export type SystemsColumnParamsDto = z.infer<typeof systemsColumnParamsSchema>;
export type SystemsToolRequirementParamsDto = z.infer<typeof systemsToolRequirementParamsSchema>;
export type SystemsStressProfileParamsDto = z.infer<typeof systemsStressProfileParamsSchema>;
export type SystemsRequestParamsDto = z.infer<typeof systemsRequestParamsSchema>;
export type SystemsActionLogQueryDto = z.infer<typeof systemsActionLogQuerySchema>;
export type TrafficLatencyQueryDto = z.infer<typeof trafficLatencyQuerySchema>;
export type TrafficLatencyTimeseriesQueryDto = z.infer<typeof trafficLatencyTimeseriesQuerySchema>;
export type RunTestSuiteDto = z.infer<typeof runTestSuiteSchema>;
export type DiscoverEndpointsDto = z.infer<typeof discoverEndpointsSchema>;
export type CatalogSeedRefreshDto = z.infer<typeof catalogSeedRefreshSchema>;
export type UpdateDataEntityMetadataDto = z.infer<typeof updateDataEntityMetadataSchema>;
export type SystemsRunsQueryDto = z.infer<typeof systemsRunsQuerySchema>;
export type SystemsSuiteQueryDto = z.infer<typeof systemsSuiteQuerySchema>;
export type ReviewDecisionDto = z.infer<typeof reviewDecisionSchema>;
export type SystemsReviewQueueDto = z.infer<typeof systemsReviewQueueSchema>;
export type SystemsStressProfileQueryDto = z.infer<typeof systemsStressProfileQuerySchema>;
export type UpsertStressProfileDto = z.infer<typeof upsertStressProfileSchema>;
