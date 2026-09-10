/**
 * @file Servicio de aplicación: convierte el artefacto de `flows:derive` en el catálogo de Flujos y lo consulta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system carga endpoints, pantallas y hallazgos por bloque, calcula riesgo e identidad estable, y sirve el explorador.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { env } from '../../config/env.js';
import { freshnessFor, verificationFromRuns } from './system-flows.verification.util.js';
import { buildFlowGraph, buildModuleGraph } from './system-flows.graph.util.js';
import { flowRowFor, mapFinding, mapFlow, mapScreen } from './system-flows.mapper.js';
import { findingKeyFor } from './system-flows.risk.util.js';
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

  /**
   * Verifica contra corridas reales (`system_action_logs`) y recalcula la frescura contra el commit
   * desplegado (`APP_COMMIT_SHA`). Sólo el bloque que escribe esos logs (el Backend) puede pasar a
   * VERIFIED por esta vía; los demás bloques quedan como estaban y se dice cuántos se saltaron.
   */
  verify(dto: VerifyFlowsDto, actor: string | null) {
    return this.repository.transaction(async (tx) => {
      const runs = dto.systemCode === 'ATLAS_BACKEND' ? await this.repository.runsByRoute(dto.windowDays) : new Map();
      const flows = await this.repository.flowsOfSystem(dto.systemCode);
      const counts = {
        verified: 0,
        broken: 0,
        unverified: 0,
        stale: 0,
        fresh: 0,
        skippedNoLogs: dto.systemCode === 'ATLAS_BACKEND' ? 0 : flows.length,
      };
      for (const flow of flows) {
        const outcome = verificationFromRuns(runs.get(`${flow.httpMethod} ${flow.path}`) ?? null, 'system_action_logs');
        if (outcome) {
          await this.repository.applyVerification(flow.flowId, outcome, actor, tx);
          if (outcome.verification === 'VERIFIED') counts.verified += 1;
          else counts.broken += 1;
        } else counts.unverified += 1;
        const freshness = freshnessFor(flow.analyzedCommit, env.APP_COMMIT_SHA);
        if (freshness && freshness !== flow.freshness) await this.repository.applyFreshness(flow.flowId, freshness, tx);
        if (freshness === 'STALE') counts.stale += 1;
        else if (freshness === 'FRESH') counts.fresh += 1;
      }
      return {
        systemCode: dto.systemCode,
        windowDays: dto.windowDays,
        deployedCommit: env.APP_COMMIT_SHA ?? null,
        routesWithRuns: runs.size,
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
