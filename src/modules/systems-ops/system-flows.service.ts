/**
 * @file Servicio de aplicación: convierte el artefacto de `flows:derive` en el catálogo de Flujos y lo consulta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system carga endpoints, pantallas y hallazgos por bloque, calcula riesgo e identidad estable, y sirve el explorador.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { env } from '../../config/env.js';
import {
  freshnessFor,
  indexBlockRuns,
  verificationFromRuns,
  type BlockAccessRun,
  type RouteRuns,
} from './system-flows.verification.util.js';
import { PlatformCatalogFederationClient } from './platform-catalog-federation.client.js';
import { buildFlowGraph, buildModuleGraph } from './system-flows.graph.util.js';
import { mapFinding, mapFlow, mapScreen } from './system-flows.mapper.js';
import { SystemFlowsImportService } from './system-flows.import.service.js';
import { SystemFlowsRepository } from './system-flows.repository.js';
import {
  FindingsListQueryDto,
  FlowsGraphQueryDto,
  FlowsListQueryDto,
  ImportEndpointsDto,
  ImportFindingsDto,
  ImportScreensDto,
  ScreensListQueryDto,
  VerifyFlowsDto,
} from './system-flows.schemas.js';

@Injectable()
export class SystemFlowsService {
  constructor(
    private readonly repository: SystemFlowsRepository,
    private readonly federation: PlatformCatalogFederationClient,
    private readonly imports_: SystemFlowsImportService,
  ) {}

  importEndpoints(dto: ImportEndpointsDto, actor: string | null) {
    return this.imports_.importEndpoints(dto, actor);
  }

  importScreens(dto: ImportScreensDto, actor: string | null) {
    return this.imports_.importScreens(dto, actor);
  }

  importFindings(dto: ImportFindingsDto, actor: string | null) {
    return this.imports_.importFindings(dto, actor);
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

  /**
   * Verifica contra corridas reales (`system_action_logs`) y recalcula la frescura contra el commit
   * desplegado (`APP_COMMIT_SHA`). Sólo el bloque que escribe esos logs (el Backend) puede pasar a
   * VERIFIED por esta vía; los demás bloques quedan como estaban y se dice cuántos se saltaron.
   */
  verify(dto: VerifyFlowsDto, actor: string | null, callerToken: string | null = null) {
    return this.repository.transaction(async (tx) => {
      // El Backend cruza por ruta contra sus propios logs; los demás bloques federan su resumen y
      // se cruzan por `MÉTODO Controller.handler`, que es la identidad que ellos registran.
      const federado = dto.systemCode === 'ATLAS_BACKEND' ? null : await this.fetchBlockRuns(dto, callerToken);
      const runs = dto.systemCode === 'ATLAS_BACKEND' ? await this.repository.runsByRoute(dto.windowDays) : (federado?.runs ?? new Map());
      const porRecurso = dto.systemCode !== 'ATLAS_BACKEND';
      const flows = await this.repository.flowsOfSystem(dto.systemCode);
      const counts = {
        verified: 0,
        broken: 0,
        unverified: 0,
        stale: 0,
        fresh: 0,
        skippedNoLogs: dto.systemCode === 'ATLAS_BACKEND' || federado?.ok ? 0 : flows.length,
      };
      for (const flow of flows) {
        const clave = porRecurso ? `${flow.httpMethod} ${flow.controller}.${flow.handler}` : `${flow.httpMethod} ${flow.path}`;
        await this.applyFlowVerification(flow, runs.get(clave) ?? null, { federado: Boolean(federado), actor, tx, counts });
      }
      return {
        systemCode: dto.systemCode,
        windowDays: dto.windowDays,
        deployedCommit: env.APP_COMMIT_SHA ?? null,
        routesWithRuns: runs.size,
        federation: federado ? { ok: federado.ok, message: federado.message } : undefined,
        ...counts,
      };
    });
  }

  /** Los procesos de negocio con sus pasos, cada uno enlazado al flujo que lo implementa. */
  async businessFlows() {
    const rows = await this.repository.businessFlows();
    const porProceso = new Map<string, Record<string, unknown>>();
    for (const row of rows as Array<Record<string, string | number | null>>) {
      const code = String(row.workflow_code);
      const proceso = porProceso.get(code) ?? {
        workflowCode: code,
        name: row.workflow_name,
        version: row.version,
        steps: [] as Array<Record<string, unknown>>,
      };
      (proceso.steps as Array<Record<string, unknown>>).push({
        stepCode: row.step_code,
        name: row.step_name,
        stage: row.stage_code,
        order: row.execution_order,
        method: row.http_method,
        path: row.route_path,
        mandatory: row.is_mandatory,
        requiresAuth: row.requires_auth,
        requiresIdempotencyKey: row.requires_idempotency_key,
        // Nulo = el paso declara una ruta que el catálogo no tiene: o cambió, o ya no existe.
        flowId: row.flow_id,
        risk: row.risk,
        verification: row.verification,
        testStatus: row.test_status,
        module: row.module,
      });
      porProceso.set(code, proceso);
    }
    const processes = [...porProceso.values()].map((p) => {
      const steps = p.steps as Array<Record<string, unknown>>;
      return {
        ...p,
        stepCount: steps.length,
        linked: steps.filter((s) => s.flowId).length,
        unlinked: steps.filter((s) => !s.flowId).length,
        verified: steps.filter((s) => s.verification === 'VERIFIED').length,
        critical: steps.filter((s) => s.risk === 'CRITICAL').length,
      };
    });
    return {
      processes,
      totals: { processes: processes.length, steps: rows.length, unlinked: processes.reduce((n, p) => n + p.unlinked, 0) },
    };
  }

  /** Aplica a un flujo lo que dicen sus corridas y su commit, y lleva la cuenta. Extraído del bucle. */
  private async applyFlowVerification(
    flow: { flowId: string; analyzedCommit: string | null; freshness: string },
    runs: RouteRuns | null,
    ctx: { federado: boolean; actor: string | null; tx: Transaction; counts: Record<string, number> },
  ) {
    const outcome = verificationFromRuns(runs, ctx.federado ? 'decision_access_audit (federado)' : 'system_action_logs');
    if (outcome) {
      await this.repository.applyVerification(flow.flowId, outcome, ctx.actor, ctx.tx);
      ctx.counts[outcome.verification === 'VERIFIED' ? 'verified' : 'broken'] += 1;
    } else ctx.counts.unverified += 1;
    const freshness = freshnessFor(flow.analyzedCommit, env.APP_COMMIT_SHA);
    if (freshness && freshness !== flow.freshness) await this.repository.applyFreshness(flow.flowId, freshness, ctx.tx);
    if (freshness) ctx.counts[freshness === 'STALE' ? 'stale' : 'fresh'] += 1;
  }

  /** Pide a otro bloque su resumen de accesos. Si no se puede, se dice por qué y no se verifica nada. */
  private async fetchBlockRuns(dto: VerifyFlowsDto, callerToken: string | null) {
    if (dto.systemCode !== 'DECISION_ENGINE') {
      return { ok: false, message: `El bloque ${dto.systemCode} no publica evidencia de ejecución HTTP.`, runs: new Map() };
    }
    const result = await this.federation.fetchFromBlock(dto.systemCode, callerToken, `v1/audit/access-runs?windowDays=${dto.windowDays}`);
    if (!result.ok) return { ok: false, message: result.message ?? 'No se pudo pedir el resumen de accesos.', runs: new Map() };
    const cuerpo = (result as { body?: { resources?: BlockAccessRun[] } }).body;
    return { ok: true, message: undefined, runs: indexBlockRuns(cuerpo?.resources ?? []) };
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
