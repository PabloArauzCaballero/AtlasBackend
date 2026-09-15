/**
 * @file Esquemas de validación: definen el contrato de entrada de Flujos (Flow Intelligence).
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system valida la carga del artefacto de `flows:derive` y las consultas del explorador de flujos.
 */
import { z } from 'zod';

const code = z.string().trim().min(1).max(60);
const stringList = z.array(z.string().trim().min(1).max(200)).max(200).default([]);

export const FLOW_RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const FLOW_KINDS = ['READ', 'CREATE', 'UPDATE', 'DELETE', 'ACTION', 'NAVIGATION', 'CLIENT_ONLY', 'CROSS_BLOCK'] as const;
export const FLOW_DISCOVERY = ['DISCOVERED', 'PARTIAL', 'MAPPED'] as const;
export const FLOW_VERIFICATION = ['UNVERIFIED', 'VERIFIED', 'BROKEN'] as const;
export const FLOW_FRESHNESS = ['FRESH', 'STALE'] as const;
export const FINDING_STATUSES = ['open', 'acknowledged', 'resolved', 'false_positive'] as const;

/** Lo que `tools/analyze.mjs` (fase 2) resolvió del handler hacia el service y la tabla. */
export const flowAnalysisSchema = z.object({
  status: z.enum(['DISCOVERED', 'PARTIAL', 'MAPPED']).default('DISCOVERED'),
  chain: z
    .array(
      z.object({
        kind: z.enum(['SERVICE', 'REPOSITORY', 'CLASS', 'FUNCTION']),
        class: z.string().max(160).nullable().optional(),
        method: z.string().max(160),
        file: z.string().max(300),
        line: z.number().int().nonnegative(),
        depth: z.number().int().nonnegative(),
      }),
    )
    .max(200)
    .default([]),
  reads: z.array(z.string().max(160)).max(200).default([]),
  writes: z
    .array(z.object({ table: z.string().max(160), op: z.string().max(20), via: z.string().max(40) }))
    .max(200)
    .default([]),
  errors: z.array(z.string().max(120)).max(100).default([]),
  blockCalls: z
    .array(z.object({ target: z.string().max(300), at: z.string().max(300) }))
    .max(50)
    .default([]),
  /**
   * Eventos de dominio que el flujo publica (`publish({ eventCode })`). `dynamic`: el código se arma en
   * ejecución y sólo se conoce su prefijo, que viaja con `*`. `via`: `publish` pasa por el registro de
   * eventos; `outbox` escribe el outbox directamente. Sin estos campos en el esquema, Zod los descartaba
   * en la importación sin avisar.
   */
  events: z
    .array(
      z.object({
        code: z.string().max(160),
        dynamic: z.boolean().default(false),
        via: z.enum(['publish', 'outbox']).default('publish'),
        at: z.string().max(300),
      }),
    )
    .max(50)
    .default([]),
  unknowns: z
    .array(z.object({ reason: z.string().max(120), at: z.string().max(300) }))
    .max(200)
    .default([]),
  transactional: z.boolean().default(false),
  /**
   * Huella del código del que cuelga el flujo. Con ella la frescura pasa a ser por FLUJO: se compara
   * la guardada con la que trae la recarga. Antes cualquier commit del repositorio marcaba STALE los
   * mil flujos del bloque, y un aviso que salta siempre deja de leerse.
   */
  depsHash: z.string().max(32).optional(),
});
export type FlowAnalysis = z.infer<typeof flowAnalysisSchema>;

/** Una fila de `endpoints.json` tal como la escribe `tools/derive.mjs`. */
export const derivedEndpointSchema = z.object({
  method: z.string().trim().toUpperCase().min(3).max(10),
  path: z.string().trim().max(400),
  module: z.string().trim().min(1).max(120),
  controller: z.string().trim().min(1).max(160),
  handler: z.string().trim().min(1).max(160),
  file: z.string().trim().max(300).optional(),
  line: z.number().int().nonnegative().optional(),
  isPublic: z.boolean().default(false),
  roles: stringList,
  internalPermissions: stringList,
  guards: stringList,
  callers: stringList,
  testStatus: z.enum(['TESTED', 'UNTESTED']).default('UNTESTED'),
  contractStatus: z.enum(['IN_CONTRACT', 'CODE_ONLY', 'NO_CONTRACT']).default('NO_CONTRACT'),
  analysis: flowAnalysisSchema.optional(),
});
export type DerivedEndpointDto = z.infer<typeof derivedEndpointSchema>;

/**
 * Cuántas filas declara el artefacto para este alcance (`manifest.counts`). Una carga con otro número está
 * truncada, y lo que falta se daría por retirado o por resuelto sin que nadie lo tocara.
 */
const declaredCount = z.number().int().nonnegative();

/**
 * Cuándo se generó el artefacto (`manifest.generatedAt`). Uno anterior al último cargado del mismo alcance es un paso
 * atrás coherente consigo mismo, que `declaredCount` no ve; se rechaza salvo `allowOlderArtifact`.
 */
const artifactAge = { artifactGeneratedAt: z.iso.datetime(), allowOlderArtifact: z.boolean().optional() };

/** Contrato de carga que el backend exige hoy. El cargador lo lee ANTES de escribir nada. */
export const IMPORT_CONTRACT = {
  version: 2,
  requires: ['declaredCount', 'artifactGeneratedAt'],
  confirmations: ['allowRemovingDecisions', 'allowRemovingMenuGates', 'allowOlderArtifact'],
} as const;

export const importsQuerySchema = z.object({
  systemCode: code.optional(),
  scope: z.enum(['endpoints', 'screens', 'findings']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(30),
});
export type ImportsQueryDto = z.infer<typeof importsQuerySchema>;

/** Una puerta del menú sin resolver (`<unresolved:…>`) no es una puerta: el artefacto tiene que resolverla antes. */
const menuGateList = z
  .array(z.string().trim().min(1).max(200).regex(/^[^<]/, 'Puerta de menú sin resolver en el artefacto.'))
  .max(200)
  .default([]);

const importEnvelope = {
  systemCode: code,
  analyzedCommit: z.string().trim().max(64).optional(),
  analyzedBranch: z.string().trim().max(80).optional(),
  contentHash: z.string().trim().max(64).optional(),
};

/**
 * `strictObject` y no `object`: zod QUITA los campos desconocidos sin decir nada, así que un cargador nuevo contra un
 * backend viejo perdía `declaredCount` —y con él todas estas comprobaciones— sin un solo error. Rechazarlos hace que
 * la próxima pareja desalineada falle en la primera carga, en vez de escribir sin comprobar.
 */
export const importEndpointsSchema = z.strictObject({
  ...importEnvelope,
  endpoints: z.array(derivedEndpointSchema).max(2000),
  /**
   * Retirar un flujo borra su revisión humana. Por defecto, una carga que lo haría se rechaza; quien sabe
   * que el bloque cambió de verdad lo confirma aquí.
   */
  allowRemovingDecisions: z.boolean().optional(),
  declaredCount,
  ...artifactAge,
});
export type ImportEndpointsDto = z.infer<typeof importEndpointsSchema>;

export const derivedScreenSchema = z.object({
  route: z.string().trim().min(1).max(300),
  file: z.string().trim().max(300).optional(),
  navLabel: z.string().trim().max(160).nullable().optional(),
  navPermissions: menuGateList,
  navRoles: menuGateList,
});
export const importScreensSchema = z.strictObject({
  clientCode: code,
  analyzedCommit: z.string().trim().max(64).optional(),
  screens: z.array(derivedScreenSchema).max(2000),
  declaredCount,
  ...artifactAge,
  /**
   * Las rutas que SÍ pueden quedarse sin puerta de menú. Es una lista y no un sí general: un artefacto viejo retira
   * varias a la vez, y confirmar «adelante» dejaba pasar en el mismo gesto la que no se había mirado.
   */
  allowRemovingMenuGates: z.array(z.string().trim().min(1).max(300)).max(2000).optional(),
});
export type ImportScreensDto = z.infer<typeof importScreensSchema>;

export const derivedFindingSchema = z.object({
  kind: z.string().trim().min(1).max(40),
  severity: z.enum(FLOW_RISKS),
  systemCode: code,
  ref: z.string().trim().min(1).max(400),
  module: z.string().trim().max(120).optional(),
  summary: z.string().trim().min(1).max(2000),
  knownSince: z.string().trim().max(300).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export const importFindingsSchema = z.strictObject({
  systemCode: code,
  analyzedCommit: z.string().trim().max(64).optional(),
  findings: z.array(derivedFindingSchema).max(5000),
  declaredCount,
  ...artifactAge,
});
export type ImportFindingsDto = z.infer<typeof importFindingsSchema>;

const pagination = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
};

export const flowsListQuerySchema = z.object({
  ...pagination,
  q: z.string().trim().min(1).max(160).optional(),
  systemCode: code.optional(),
  module: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(FLOW_KINDS).optional(),
  risk: z.enum(FLOW_RISKS).optional(),
  discovery: z.enum(FLOW_DISCOVERY).optional(),
  verification: z.enum(FLOW_VERIFICATION).optional(),
  freshness: z.enum(FLOW_FRESHNESS).optional(),
  caller: z.string().trim().min(1).max(40).optional(),
  role: z.string().trim().min(1).max(120).optional(),
  table: z.string().trim().min(1).max(160).optional(),
  isPublic: z.coerce.boolean().optional(),
  tested: z.coerce.boolean().optional(),
  withFindings: z.coerce.boolean().optional(),
});
export type FlowsListQueryDto = z.infer<typeof flowsListQuerySchema>;

export const flowsGraphQuerySchema = z.object({
  systemCode: code,
  module: z.string().trim().min(1).max(120),
  includeRoles: z.coerce.boolean().default(false),
});
export type FlowsGraphQueryDto = z.infer<typeof flowsGraphQuerySchema>;

export const verifyFlowsSchema = z.object({
  /** Ventana hacia atrás sobre `system_action_logs`. 30 días por defecto: una corrida más vieja no dice nada del código actual. */
  windowDays: z.coerce.number().int().positive().max(365).default(30),
  systemCode: code.default('ATLAS_BACKEND'),
});
export type VerifyFlowsDto = z.infer<typeof verifyFlowsSchema>;

export const flowIdParamsSchema = z.object({
  flowId: z
    .string()
    .trim()
    .regex(/^flow_[a-f0-9]{12}$/),
});
export type FlowIdParamsDto = z.infer<typeof flowIdParamsSchema>;

export const screensListQuerySchema = z.object({
  ...pagination,
  clientCode: code.optional(),
  q: z.string().trim().min(1).max(160).optional(),
});
export type ScreensListQueryDto = z.infer<typeof screensListQuerySchema>;

export const findingsListQuerySchema = z.object({
  ...pagination,
  systemCode: code.optional(),
  kind: z.string().trim().min(1).max(40).optional(),
  severity: z.enum(FLOW_RISKS).optional(),
  status: z.enum(FINDING_STATUSES).optional(),
  q: z.string().trim().min(1).max(160).optional(),
});
export type FindingsListQueryDto = z.infer<typeof findingsListQuerySchema>;
