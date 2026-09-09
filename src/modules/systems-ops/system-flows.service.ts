/**
 * @file Servicio de aplicación: convierte el artefacto de `flows:derive` en el catálogo de Flujos y lo consulta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system carga endpoints, pantallas y hallazgos por bloque, calcula riesgo e identidad estable, y sirve el explorador.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { SystemFlowCatalogModel, SystemFlowFindingModel, SystemScreenCatalogModel } from '../../database/models/index.js';
import { buildFlowGraph, buildModuleGraph } from './system-flows.graph.util.js';
import { SystemFlowsRepository } from './system-flows.repository.js';
import {
  findingKeyFor,
  flowBadgesFor,
  flowIdFor,
  flowKindFor,
  flowNameFor,
  flowRiskFor,
  flowRiskFromTables,
  flowSlugFor,
} from './system-flows.risk.util.js';
import {
  DerivedEndpointDto,
  FlowAnalysis,
  FindingsListQueryDto,
  FlowsGraphQueryDto,
  FlowsListQueryDto,
  ImportEndpointsDto,
  ImportFindingsDto,
  ImportScreensDto,
  ScreensListQueryDto,
} from './system-flows.schemas.js';

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
    sourceFile: row.sourceFile,
    sourceLine: row.sourceLine,
    isPublic: row.isPublic,
    roles: row.roles,
    internalPermissions: row.internalPermissions,
    guards: row.guards,
    callers: row.callers,
    testStatus: row.testStatus,
    contractStatus: row.contractStatus,
    findingsCount: row.findingsCount,
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
    sourceFile: row.sourceFile,
    navLabel: row.navLabel,
    navPermissions: row.navPermissions,
    navRoles: row.navRoles,
    analyzedCommit: row.analyzedCommit,
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
  const analysis = endpoint.analysis && endpoint.analysis.status !== 'DISCOVERED' ? endpoint.analysis : null;
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

@Injectable()
export class SystemFlowsService {
  constructor(private readonly repository: SystemFlowsRepository) {}

  importEndpoints(dto: ImportEndpointsDto, actor: string | null) {
    return this.repository.transaction(async (tx) => {
      const record = await this.repository.createImport(
        {
          scope: 'endpoints',
          systemCode: dto.systemCode,
          analyzedCommit: dto.analyzedCommit ?? null,
          analyzedBranch: dto.analyzedBranch ?? null,
          contentHash: dto.contentHash ?? null,
          rowsReceived: dto.endpoints.length,
          rowsUpserted: 0,
          rowsRemoved: 0,
          createdBy: actor,
        },
        tx,
      );
      const rows = dto.endpoints.map((endpoint) =>
        flowRowFor(dto.systemCode, endpoint, {
          analyzedCommit: dto.analyzedCommit,
          analyzedBranch: dto.analyzedBranch,
          importId: record.id,
        }),
      );
      const result = await this.repository.replaceFlows(dto.systemCode, rows, tx);
      await this.repository.recountFindings(dto.systemCode, tx);
      await record.update({ rowsUpserted: result.upserted, rowsRemoved: result.removed }, { transaction: tx });
      return { importId: record.id, ...result };
    });
  }

  importScreens(dto: ImportScreensDto, actor: string | null) {
    return this.repository.transaction(async (tx) => {
      const record = await this.repository.createImport(
        {
          scope: 'screens',
          systemCode: dto.clientCode,
          analyzedCommit: dto.analyzedCommit ?? null,
          analyzedBranch: null,
          contentHash: null,
          rowsReceived: dto.screens.length,
          rowsUpserted: 0,
          rowsRemoved: 0,
          createdBy: actor,
        },
        tx,
      );
      const rows = dto.screens.map((screen) => ({
        clientCode: dto.clientCode,
        route: screen.route,
        sourceFile: screen.file ?? null,
        navLabel: screen.navLabel ?? null,
        navPermissions: screen.navPermissions,
        navRoles: screen.navRoles,
        analyzedCommit: dto.analyzedCommit ?? null,
        importId: record.id,
      }));
      const result = await this.repository.replaceScreens(dto.clientCode, rows, tx);
      await record.update({ rowsUpserted: result.upserted, rowsRemoved: result.removed }, { transaction: tx });
      return { importId: record.id, ...result };
    });
  }

  importFindings(dto: ImportFindingsDto, actor: string | null) {
    return this.repository.transaction(async (tx) => {
      const record = await this.repository.createImport(
        {
          scope: 'findings',
          systemCode: dto.systemCode,
          analyzedCommit: dto.analyzedCommit ?? null,
          analyzedBranch: null,
          contentHash: null,
          rowsReceived: dto.findings.length,
          rowsUpserted: 0,
          rowsRemoved: 0,
          createdBy: actor,
        },
        tx,
      );
      const rows = dto.findings
        .filter((finding) => finding.systemCode === dto.systemCode)
        .map((finding) => ({
          findingKey: findingKeyFor(finding),
          kind: finding.kind,
          severity: finding.severity,
          systemCode: finding.systemCode,
          ref: finding.ref,
          module: finding.module ?? null,
          summary: finding.summary,
          extraJson: finding.extra ?? {},
          knownSince: finding.knownSince ?? null,
          importId: record.id,
        }));
      const result = await this.repository.replaceFindings(dto.systemCode, rows, tx);
      await this.repository.recountFindings(dto.systemCode, tx);
      await record.update({ rowsUpserted: result.upserted, rowsRemoved: result.removed }, { transaction: tx });
      return { importId: record.id, ...result, ignored: dto.findings.length - rows.length };
    });
  }

  async listFlows(query: FlowsListQueryDto) {
    const result = await this.repository.listFlows(query);
    return { items: result.rows.map(mapFlow), meta: result.meta };
  }

  async getFlow(flowId: string) {
    const row = await this.repository.findFlow(flowId);
    if (!row) throw new NotFoundException(`No existe el flujo ${flowId}.`);
    const findings = await this.repository.findingsForRef(row.systemCode, `${row.httpMethod} ${row.path}`);
    return { ...mapFlow(row), findings: findings.map(mapFinding) };
  }

  async getFlowGraph(flowId: string) {
    const row = await this.repository.findFlow(flowId);
    if (!row) throw new NotFoundException(`No existe el flujo ${flowId}.`);
    return buildFlowGraph(row);
  }

  async getModuleGraph(query: FlowsGraphQueryDto) {
    const rows = await this.repository.findFlowsByModule(query.systemCode, query.module);
    if (!rows.length) throw new NotFoundException(`No hay flujos para ${query.systemCode}/${query.module}.`);
    return buildModuleGraph(rows, { includeRoles: query.includeRoles });
  }

  summary() {
    return this.repository.summary();
  }

  modules() {
    return this.repository.modules();
  }

  async listScreens(query: ScreensListQueryDto) {
    const result = await this.repository.listScreens(query);
    return { items: result.rows.map(mapScreen), meta: result.meta };
  }

  async listFindings(query: FindingsListQueryDto) {
    const result = await this.repository.listFindings(query);
    return { items: result.rows.map(mapFinding), meta: result.meta };
  }

  async imports() {
    const rows = await this.repository.latestImports();
    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      systemCode: row.systemCode,
      analyzedCommit: row.analyzedCommit,
      analyzedBranch: row.analyzedBranch,
      contentHash: row.contentHash,
      rowsReceived: row.rowsReceived,
      rowsUpserted: row.rowsUpserted,
      rowsRemoved: row.rowsRemoved,
      createdBy: row.createdBy,
      createdAt: row.createdAtValue,
    }));
  }
}
