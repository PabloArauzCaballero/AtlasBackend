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
  unknowns: z
    .array(z.object({ reason: z.string().max(120), at: z.string().max(300) }))
    .max(200)
    .default([]),
  transactional: z.boolean().default(false),
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

const importEnvelope = {
  systemCode: code,
  analyzedCommit: z.string().trim().max(64).optional(),
  analyzedBranch: z.string().trim().max(80).optional(),
  contentHash: z.string().trim().max(64).optional(),
};

export const importEndpointsSchema = z.object({ ...importEnvelope, endpoints: z.array(derivedEndpointSchema).max(2000) });
export type ImportEndpointsDto = z.infer<typeof importEndpointsSchema>;

export const derivedScreenSchema = z.object({
  route: z.string().trim().min(1).max(300),
  file: z.string().trim().max(300).optional(),
  navLabel: z.string().trim().max(160).nullable().optional(),
  navPermissions: stringList,
  navRoles: stringList,
});
export const importScreensSchema = z.object({
  clientCode: code,
  analyzedCommit: z.string().trim().max(64).optional(),
  screens: z.array(derivedScreenSchema).max(2000),
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
export const importFindingsSchema = z.object({
  systemCode: code,
  analyzedCommit: z.string().trim().max(64).optional(),
  findings: z.array(derivedFindingSchema).max(5000),
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
