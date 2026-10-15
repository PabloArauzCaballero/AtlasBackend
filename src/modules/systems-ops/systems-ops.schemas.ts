/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { z } from 'zod';
import { queryBooleanSchema } from '../../common/pipes/query-boolean.schema.js';

const positiveId = z.string().regex(/^[1-9][0-9]*$/);

export const systemsListQuerySchema = z.object({
  module: z.string().trim().min(1).max(120).optional(),
  /**
   * Bloque del ecosistema: `ATLAS_BACKEND`, `DECISION_ENGINE`, `ERP_BACKEND`.
   *
   * Distinto de `backendService`, que identifica el PROCESO que sirve la ruta. Este identifica el
   * PRODUCTO, y es por el que el portal agrupa el catálogo. Se valida como texto libre acotado y no
   * como enum para que añadir un cuarto bloque no sea un cambio de contrato de la API.
   */
  block: z.string().trim().min(1).max(60).optional(),
  backendService: z.string().trim().min(1).max(120).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  reviewStatus: z.enum(['AUTO_DETECTED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  /** Sólo lo que guarda o expone datos personales (tablas: PII, legal, ubicación o dispositivo; rutas: PII o campos personales). */
  personalData: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export * from './systems-ops.params.schemas.js';
export * from './systems-ops.query.schemas.js';
export * from './systems-ops.test-suite.schemas.js';
import { environmentSchema, jsonObjectSchema } from './systems-ops.test-suite.schemas.js';

export const inferToolRequirementsSchema = z.object({
  persist: z.boolean().default(true),
});

export const queueStressRunSchema = z.object({
  environment: environmentSchema.default('LOCAL'),
  dryRun: z.boolean().default(true),
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
  containsPii: queryBooleanSchema.optional(),
  /** Texto libre: busca en la ruta (plantilla y URL saneada) y en el rol del actor. */
  q: z.string().trim().min(1).max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
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
  /** Texto libre: ruta, código, módulo, tabla, columna, campo o herramienta, según la familia. */
  q: z.string().trim().min(1).max(200).optional(),
  reviewStatus: z.enum(['AUTO_DETECTED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED']).default('NEEDS_REVIEW'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const systemsStressProfileQuerySchema = z.object({
  endpointId: positiveId.optional(),
  status: z.string().trim().min(1).max(40).optional(),
  enabled: queryBooleanSchema.optional(),
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
  isEnabled: z.boolean().default(true),
  requiresApproval: z.boolean().default(true),
  status: z.enum(['ACTIVE', 'DISABLED', 'NEEDS_REVIEW', 'DEPRECATED']).default('ACTIVE'),
  notes: z.string().trim().max(2000).optional(),
});

export const runTestSuiteSchema = z.object({
  environment: z.enum(['LOCAL', 'STAGING', 'PRODUCTION_READONLY']).default('LOCAL'),
  dryRun: z.boolean().default(true),
  baseUrl: z.string().url().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.coerce.number().int().min(100).max(60000).default(10000),
});

/**
 * `OPENAPI_CONTRACT` es el modo por defecto y el único que funciona en un despliegue real.
 *
 * `SOURCE_SCAN` lee `src/modules` con expresiones regulares, y la imagen de producción sólo copia
 * `dist/` y `src/database`: dentro de un contenedor devolvía `discovered: 0` y lo reportaba como un
 * éxito. Se conserva porque en una máquina de desarrollo sigue aportando lo que el contrato no dice
 * —el controlador y el handler de cada ruta—, pero ya no es lo que se ejecuta al pulsar el botón.
 */
export const discoverEndpointsSchema = z.object({
  mode: z.enum(['OPENAPI_CONTRACT', 'SOURCE_SCAN']).default('OPENAPI_CONTRACT'),
  persist: z.boolean().default(true),
});

export const catalogSeedRefreshSchema = z.object({
  includeTools: z.boolean().default(true),
  includeDataEntities: z.boolean().default(true),
  includeEndpointSeeds: z.boolean().default(true),
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

export type InferToolRequirementsDto = z.infer<typeof inferToolRequirementsSchema>;
export type QueueStressRunDto = z.infer<typeof queueStressRunSchema>;
export type SystemsListQueryDto = z.infer<typeof systemsListQuerySchema>;
export type SystemsColumnParamsDto = z.infer<typeof systemsColumnParamsSchema>;
export type SystemsActionLogQueryDto = z.infer<typeof systemsActionLogQuerySchema>;
export type TrafficLatencyTimeseriesQueryDto = z.infer<typeof trafficLatencyTimeseriesQuerySchema>;
export type RunTestSuiteDto = z.infer<typeof runTestSuiteSchema>;
export type DiscoverEndpointsDto = z.infer<typeof discoverEndpointsSchema>;
export type CatalogSeedRefreshDto = z.infer<typeof catalogSeedRefreshSchema>;
export type UpdateDataEntityMetadataDto = z.infer<typeof updateDataEntityMetadataSchema>;
export type ReviewDecisionDto = z.infer<typeof reviewDecisionSchema>;
export type SystemsReviewQueueDto = z.infer<typeof systemsReviewQueueSchema>;
export type SystemsStressProfileQueryDto = z.infer<typeof systemsStressProfileQuerySchema>;
export type UpsertStressProfileDto = z.infer<typeof upsertStressProfileSchema>;
