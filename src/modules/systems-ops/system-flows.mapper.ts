/**
 * @file Mapeadores de Flujos: fila de base ↔ DTO, y endpoint derivado → fila del catálogo.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system traduce entre el artefacto de `flows:derive`, las tablas `system_flow_*` y lo que ve el portal.
 */
import { SystemFlowCatalogModel, SystemFlowFindingModel, SystemScreenCatalogModel } from '../../database/models/index.js';
import {
  flowBadgesFor,
  flowIdFor,
  flowKindFor,
  flowNameFor,
  flowRiskFor,
  flowRiskFromTables,
  flowSlugFor,
} from './system-flows.risk.util.js';
import { DerivedEndpointDto, FlowAnalysis } from './system-flows.schemas.js';
import { env } from '../../config/env.js';

/** La ficha no manda la cadena entera (puede tener 120 pasos): manda lo que se lee de un vistazo. */
export function summarizeAnalysis(analysis: Record<string, unknown>) {
  if (!analysis || !('status' in analysis)) return null;
  const a = analysis as FlowAnalysis;
  return {
    status: a.status,
    chainLength: a.chain.length,
    services: [...new Set(a.chain.map((s) => s.class ?? s.method))].slice(0, 20),
    writes: a.writes,
    errors: a.errors,
    blockCalls: a.blockCalls,
    unknowns: a.unknowns.slice(0, 10),
    transactional: a.transactional,
  };
}

export function mapFlow(row: SystemFlowCatalogModel) {
  return {
    id: row.flowId,
    slug: row.slug,
    systemCode: row.systemCode,
    name: row.name,
    module: row.module,
    kind: row.kind,
    risk: row.risk,
    riskBasis: row.riskBasis,
    badges: row.badges,
    discovery: row.discovery,
    verification: row.verification,
    freshness: row.freshness,
    httpMethod: row.httpMethod,
    path: `/${row.path}`,
    controller: row.controller,
    handler: row.handler,
    // Fichero y línea sólo si el despliegue lo permite: es el atajo al código, y también el árbol
    // de fuentes servido por HTTP a quien tenga una sesión con `systems.flows.read`.
    sourceFile: env.FLOWS_EXPOSE_SOURCE ? row.sourceFile : null,
    sourceLine: env.FLOWS_EXPOSE_SOURCE ? row.sourceLine : null,
    isPublic: row.isPublic,
    roles: row.roles,
    internalPermissions: row.internalPermissions,
    guards: row.guards,
    callers: row.callers,
    testStatus: row.testStatus,
    contractStatus: row.contractStatus,
    findingsCount: row.findingsCount,
    verifiedAt: row.verifiedAt,
    verifiedBy: row.verifiedBy,
    verificationEvidence: row.verificationEvidenceJson,
    reads: row.reads,
    writes: row.writes,
    analysis: summarizeAnalysis(row.analysisJson),
    analyzedCommit: row.analyzedCommit,
    analyzedBranch: row.analyzedBranch,
    updatedAt: row.updatedAtValue,
  };
}

export function mapScreen(row: SystemScreenCatalogModel) {
  return {
    clientCode: row.clientCode,
    route: row.route,
    sourceFile: env.FLOWS_EXPOSE_SOURCE ? row.sourceFile : null,
    navLabel: row.navLabel,
    navPermissions: row.navPermissions,
    navRoles: row.navRoles,
    analyzedCommit: row.analyzedCommit,
    verification: row.verification,
    verifiedAt: row.verifiedAt,
    lastSeenAt: row.lastSeenAt,
    // Vacío = nadie ha abierto esta pantalla desde que se mide, NO que no llame a nada.
    observed: row.observed ?? {},
  };
}

export function mapFinding(row: SystemFlowFindingModel) {
  return {
    id: row.id,
    key: row.findingKey,
    kind: row.kind,
    severity: row.severity,
    systemCode: row.systemCode,
    ref: row.ref,
    module: row.module,
    summary: row.summary,
    extra: row.extraJson,
    knownSince: row.knownSince,
    status: row.status,
    updatedAt: row.updatedAtValue,
  };
}

/** Con análisis (fase 2) el riesgo sale de las tablas escritas; sin él, del módulo. La base queda declarada en la fila. */
function riskOf(endpoint: DerivedEndpointDto, kind: ReturnType<typeof flowKindFor>) {
  // Un análisis que no llegó a ninguna tabla no puede decidir el riesgo POR tablas: daría LOW con
  // base `tables-written`, que suena a medido cuando en realidad no se resolvió nada. En ese caso
  // se vuelve a la heurística de módulo, que al menos declara lo que es. Son 62 de los 81 PARTIAL
  // del Backend: casi todos los que se quedaron a medias, no unos pocos raros.
  const parcialSinDatos = endpoint.analysis?.status === 'PARTIAL' && !endpoint.analysis.writes.length && !endpoint.analysis.reads.length;
  const analysis = endpoint.analysis && endpoint.analysis.status !== 'DISCOVERED' && !parcialSinDatos ? endpoint.analysis : null;
  if (!analysis) return { value: flowRiskFor(endpoint, kind), basis: 'module-heuristic', analysis: null };
  const isPublicWrite =
    kind !== 'READ' && endpoint.isPublic && !endpoint.roles.length && !endpoint.internalPermissions.length && endpoint.module !== 'auth';
  return { value: flowRiskFromTables(analysis, kind, isPublicWrite), basis: 'tables-written', analysis };
}

/** Un endpoint derivado → la fila de flujo (nivel 2). Sin base de datos: es una función pura y se prueba sola. */
export function flowRowFor(
  systemCode: string,
  endpoint: DerivedEndpointDto,
  meta: { analyzedCommit?: string; analyzedBranch?: string; importId: string | null },
) {
  const kind = flowKindFor(endpoint.method, endpoint.path);
  const risk = riskOf(endpoint, kind);
  return {
    flowId: flowIdFor(systemCode, endpoint.method, endpoint.path),
    slug: flowSlugFor(systemCode, endpoint),
    systemCode,
    name: flowNameFor(endpoint),
    module: endpoint.module,
    kind,
    risk: risk.value,
    riskBasis: risk.basis,
    badges: flowBadgesFor(endpoint, kind),
    discovery: risk.analysis?.status ?? 'DISCOVERED',
    verification: 'UNVERIFIED',
    freshness: 'FRESH',
    httpMethod: endpoint.method,
    path: endpoint.path,
    controller: endpoint.controller,
    handler: endpoint.handler,
    sourceFile: endpoint.file ?? null,
    sourceLine: endpoint.line ?? null,
    isPublic: endpoint.isPublic,
    roles: endpoint.roles,
    internalPermissions: endpoint.internalPermissions,
    guards: endpoint.guards,
    callers: endpoint.callers,
    testStatus: endpoint.testStatus,
    contractStatus: endpoint.contractStatus,
    findingsCount: 0,
    analysisJson: risk.analysis ?? {},
    reads: risk.analysis?.reads ?? [],
    writes: risk.analysis ? [...new Set(risk.analysis.writes.map((w) => w.table))].sort() : [],
    analyzedCommit: meta.analyzedCommit ?? null,
    analyzedBranch: meta.analyzedBranch ?? null,
    importId: meta.importId,
  };
}
