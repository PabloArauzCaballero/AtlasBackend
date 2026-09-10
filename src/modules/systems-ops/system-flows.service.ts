/**
 * @file Servicio de aplicación: convierte el artefacto de `flows:derive` en el catálogo de Flujos y lo consulta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system carga endpoints, pantallas y hallazgos por bloque, calcula riesgo e identidad estable, y sirve el explorador.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { env } from '../../config/env.js';
import {
  indexBlockPathRuns,
  indexBlockRuns,
  type BlockAccessRun,
  type BlockPathRun,
  type RouteRuns,
  verificationFromRuns,
} from './system-flows.verification.util.js';
import { PlatformCatalogFederationClient } from './platform-catalog-federation.client.js';
import { buildFlowGraph, buildModuleGraph } from './system-flows.graph.util.js';
import { mapFinding, mapFlow, mapScreen } from './system-flows.mapper.js';
import { SystemFlowsImportService } from './system-flows.import.service.js';
import { SystemFlowsRepository } from './system-flows.repository.js';
import { SystemFlowsAsyncService } from './system-flows.async.service.js';
import { SystemFlowsScreensService } from './system-flows.screens.service.js';
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

/** Lo mínimo de un flujo que hace falta para nombrarlo en el índice de otro bloque. */
type FlujoIdentificable = { httpMethod: string; path: string; controller: string | null; handler: string | null };

/**
 * Dónde pide cada bloque su evidencia de ejecución, cómo se indexa lo que devuelve y —lo que de
 * verdad separa a un bloque de otro— con qué identidad se cruza: el Motor sólo registra controlador
 * y handler, el ERP registra la plantilla de ruta. Cruzarlos con la clave del otro no da un error:
 * da cero coincidencias, que se leería como «nada se ejecutó». Por eso la clave vive aquí, junto a
 * la fuente que la produce, y no en un `if` del bucle de verificación.
 */
type EvidenciaDeBloque = {
  /** Ruta de la evidencia en ese bloque, leída de su configuración; `dias` es la ventana pedida. */
  path: (dias: number) => string;
  index: (body: unknown) => Map<string, RouteRuns>;
  key: (flow: FlujoIdentificable) => string;
  /** Qué se guarda como procedencia de la verificación: de dónde salió, textualmente. */
  source: string;
};

const ACCESS_EVIDENCE: Record<string, EvidenciaDeBloque> = {
  DECISION_ENGINE: {
    path: (dias) => `${env.DECISION_ENGINE_ACCESS_RUNS_PATH}?windowDays=${dias}`,
    index: (body) => indexBlockRuns((body as { resources?: BlockAccessRun[] })?.resources ?? []),
    key: (flow) => `${flow.httpMethod} ${flow.controller}.${flow.handler}`,
    source: 'decision_access_audit (federado)',
  },
  DASHBOARDS: {
    // Este bloque no instrumenta nada nuevo: su `MetricsInterceptor` ya contaba las peticiones por
    // (método, patrón de ruta, estado) para Prometheus, y lo que publica es ese mismo contador.
    path: () => env.DASHBOARDS_ACCESS_RUNS_PATH,
    index: (body) => indexBlockPathRuns((body as { entries?: BlockPathRun[] })?.entries ?? []),
    key: (flow) => `${flow.httpMethod} ${flow.path}`,
    source: 'atlas_dashboards_http_requests_total (federado, desde el arranque del proceso)',
  },
  ERP_BACKEND: {
    // El ERP no acota por ventana: cuenta desde que arrancó la instancia y lo declara en la respuesta.
    path: () => env.ERP_BACKEND_ACCESS_RUNS_PATH,
    index: (body) => indexBlockPathRuns((body as { entries?: BlockPathRun[] })?.entries ?? []),
    key: (flow) => `${flow.httpMethod} ${flow.path}`,
    source: 'http_access_registry (federado, desde el arranque del proceso)',
  },
};

@Injectable()
export class SystemFlowsService {
  constructor(
    private readonly repository: SystemFlowsRepository,
    private readonly federation: PlatformCatalogFederationClient,
    private readonly imports_: SystemFlowsImportService,
    private readonly screensService: SystemFlowsScreensService,
    private readonly asyncService: SystemFlowsAsyncService,
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
      const { fuente, federado, runs } = await this.gatherRuns(dto, callerToken);
      const flows = await this.repository.flowsOfSystem(dto.systemCode);
      const counts = {
        verified: 0,
        broken: 0,
        unverified: 0,
        stale: 0,
        fresh: 0,
        skippedNoLogs: !federado || federado.ok ? 0 : flows.length,
      };
      const source = fuente?.source ?? 'system_action_logs';
      for (const flow of flows) {
        const clave = fuente ? fuente.key(flow) : `${flow.httpMethod} ${flow.path}`;
        await this.applyFlowVerification(flow, runs.get(clave) ?? null, { source, actor, tx, counts });
      }
      return {
        systemCode: dto.systemCode,
        windowDays: dto.windowDays,
        deployedCommit: env.APP_COMMIT_SHA ?? null,
        routesWithRuns: runs.size,
        federation: federado ? { ok: federado.ok, message: federado.message } : undefined,
        ...counts,
        screens: await this.screensService.verify(dto, tx),
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

  /**
   * De dónde salen las corridas de este bloque. El Backend las lee de sus propios logs; los demás
   * federan el resumen que publican y se cruzan con la identidad que cada uno registra: quién la
   * declara está en `ACCESS_EVIDENCE`, no en un `if` de este método.
   */
  private async gatherRuns(dto: VerifyFlowsDto, callerToken: string | null) {
    if (dto.systemCode === 'ATLAS_BACKEND') {
      return { fuente: undefined, federado: null, runs: await this.repository.runsByRoute(dto.windowDays) };
    }
    const fuente = ACCESS_EVIDENCE[dto.systemCode];
    const federado = await this.fetchBlockRuns(dto, callerToken, fuente);
    return { fuente, federado, runs: federado.runs };
  }

  /** Aplica a un flujo lo que dicen sus corridas y su commit, y lleva la cuenta. Extraído del bucle. */
  private async applyFlowVerification(
    flow: { flowId: string; analyzedCommit: string | null; freshness: string; depsChangedAt: Date | null },
    runs: RouteRuns | null,
    ctx: { source: string; actor: string | null; tx: Transaction; counts: Record<string, number> },
  ) {
    const outcome = verificationFromRuns(runs, ctx.source);
    if (outcome) {
      await this.repository.applyVerification(flow.flowId, outcome, ctx.actor, ctx.tx, flow.depsChangedAt);
      ctx.counts[outcome.verification === 'VERIFIED' ? 'verified' : 'broken'] += 1;
    } else ctx.counts.unverified += 1;
    // La frescura ya NO se decide aquí. La decidía comparando el commit analizado con el desplegado,
    // así que cualquier commit del repositorio marcaba STALE los mil flujos del bloque —incluidos los
    // novecientos que nadie tocó— y el aviso dejaba de leerse. Ahora la fija la recarga, por flujo y
    // por huella de su código. Aquí sólo se cuenta lo que hay guardado.
    ctx.counts[flow.freshness === 'STALE' ? 'stale' : 'fresh'] += 1;
  }

  /** Pide a otro bloque su resumen de accesos. Si no se puede, se dice por qué y no se verifica nada. */
  private async fetchBlockRuns(dto: VerifyFlowsDto, callerToken: string | null, fuente: EvidenciaDeBloque | undefined) {
    // Cada bloque publica lo que de verdad tiene, y se cruza como corresponda: el Motor identifica
    // sus accesos por controlador y handler; el ERP, por ruta y código HTTP, como el Backend.
    if (!fuente) {
      return { ok: false, message: `El bloque ${dto.systemCode} no publica evidencia de ejecución HTTP.`, runs: new Map() };
    }
    const result = await this.federation.fetchFromBlock(dto.systemCode, callerToken, fuente.path(dto.windowDays));
    if (!result.ok) return { ok: false, message: result.message ?? 'No se pudo pedir el resumen de accesos.', runs: new Map() };
    return { ok: true, message: undefined, runs: fuente.index((result as { body?: unknown }).body) };
  }

  /** Qué deja encargado cada flujo y si alguien lo recoge. Ver el servicio. */
  pendingWork(windowDays?: number) {
    return this.asyncService.pendingWork(windowDays);
  }

  /** Pantallas protegidas por permiso cuyos endpoints no exigen ninguno. Ver el servicio. */
  rbacDrift() {
    return this.screensService.rbacDrift();
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
