/**
 * @file Caso de uso: la sección Procesos del portal admin.
 * @business Esta pieza contesta, para cada proceso de Atlas, si está documentado, si cada paso de una persona tiene pantalla y cuántos casos hay en curso.
 * @system lee las fixtures del código desplegado, la huella del volcado y el catálogo de Flujos; nunca escribe.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { definitionHash } from '../definitions/workflow-catalog.sync.js';
import { WORKFLOW_DEFINITIONS } from '../definitions/workflow-definitions.registry.js';
import type { ProcessStageFixture, ProcessStepFixture, WorkflowDefinitionFixture } from '../definitions/workflow-definition.types.js';
import { ProcessCatalogRepository, type FlowRow, type SyncRow } from '../process-catalog.repository.js';

const MIN_NARRATIVE = 80;
const PERSON_ACTORS = new Set(['internal_user', 'merchant_user', 'platform_user']);
const PORTALS = new Set(['ADMIN_PORTAL', 'ERP_PORTAL', 'MOTOR_PORTAL', 'DASHBOARDS_PORTAL']);

/** Estado de cableado de un paso: una persona lo ejecuta en un portal; ¿ese portal llama a su ruta? */
export type StepWiring = 'wired' | 'unwired' | 'unknown' | 'not_applicable';

const flowKey = (system: string, method: string, path: string) =>
  `${system} ${method.toUpperCase()} ${path
    .replace(/^\/+/, '')
    .replace(/:[A-Za-z0-9_]+/g, ':p')
    .replace(/\/$/, '')}`;

function stepWiring(
  stage: ProcessStageFixture,
  step: ProcessStepFixture,
  flows: Map<string, FlowRow>,
): { wiring: StepWiring; flow?: FlowRow } {
  const kind = step.kind ?? 'http';
  if (kind !== 'http' || !PERSON_ACTORS.has(stage.actor) || !PORTALS.has(stage.client)) return { wiring: 'not_applicable' };
  const flow = flows.get(flowKey(step.system ?? 'ATLAS_BACKEND', step.method ?? 'GET', step.path ?? '/'));
  if (!flow) return { wiring: 'unknown' };
  // El ERP-front llega a Core por la pasarela del ERP: para él, cableado es que el ERP llame a la ruta.
  const via = stage.client === 'ERP_PORTAL' && (step.system ?? 'ATLAS_BACKEND') === 'ATLAS_BACKEND' ? 'ERP_BACKEND' : stage.client;
  return { wiring: flow.callers.includes(via) ? 'wired' : 'unwired', flow };
}

function docStatus(f: WorkflowDefinitionFixture, sync: SyncRow | undefined) {
  const narrative = Object.values(f.narrative).every((t) => t.trim().length >= MIN_NARRATIVE);
  const personStages = f.stages.filter((s) => PERSON_ACTORS.has(s.actor) && PORTALS.has(s.client));
  const screens = personStages.every((s) => Boolean(s.screen || s.link));
  const inDatabase = sync?.contentHash === definitionHash(f);
  const checks = { narrative, owner: Boolean(f.ownerRole), instanceEntity: Boolean(f.instanceEntity), screens, inDatabase };
  return { ...checks, complete: Object.values(checks).every(Boolean), syncedAt: sync?.appliedAt ?? null };
}

@Injectable()
export class ProcessCatalogService {
  constructor(private readonly repository: ProcessCatalogRepository) {}

  private find(code: string): WorkflowDefinitionFixture {
    const f = WORKFLOW_DEFINITIONS.find((d) => d.code === code);
    if (!f) throw new NotFoundException({ code: 'PROCESS_NOT_FOUND', message: `No hay un proceso ${code}.` });
    return f;
  }

  private async flowsOf(fixtures: readonly WorkflowDefinitionFixture[]): Promise<Map<string, FlowRow>> {
    const keys = fixtures.flatMap((f) =>
      f.stages.flatMap((s) =>
        s.steps
          .filter((p) => (p.kind ?? 'http') === 'http')
          .map((p) => {
            const [systemCode, method, path] = flowKey(p.system ?? 'ATLAS_BACKEND', p.method ?? 'GET', p.path ?? '/').split(' ');
            return { systemCode: systemCode!, method: method!, path: path ?? '' };
          }),
      ),
    );
    const rows = await this.repository.flowsFor(keys);
    return new Map(rows.map((r) => [flowKey(r.systemCode, r.method, r.path), r]));
  }

  private wiringSummary(f: WorkflowDefinitionFixture, flows: Map<string, FlowRow>) {
    const counts = { wired: 0, unwired: 0, unknown: 0 };
    for (const s of f.stages)
      for (const p of s.steps) {
        const { wiring } = stepWiring(s, p, flows);
        if (wiring !== 'not_applicable') counts[wiring]++;
      }
    return { ...counts, personSteps: counts.wired + counts.unwired + counts.unknown };
  }

  /**
   * Cuántos pasos HTTP del proceso tienen flujo en el catálogo, cuántos de ellos son de riesgo
   * CRITICAL y cuántos están verificados con corridas reales. Son los contadores que sólo enseñaba
   * «Procesos de negocio», que leía el volcado en base y no el código desplegado.
   */
  private flowStats(f: WorkflowDefinitionFixture, flows: Map<string, FlowRow>) {
    const found = f.stages.flatMap((s) =>
      s.steps
        .filter((p) => (p.kind ?? 'http') === 'http')
        .map((p) => flows.get(flowKey(p.system ?? 'ATLAS_BACKEND', p.method ?? 'GET', p.path ?? '/')))
        .filter((flow): flow is FlowRow => Boolean(flow)),
    );
    return {
      linked: found.length,
      critical: found.filter((flow) => flow.risk === 'CRITICAL').length,
      verified: found.filter((flow) => flow.verification === 'VERIFIED').length,
    };
  }

  async list() {
    const [syncRows, flows] = await Promise.all([this.repository.syncRows(), this.flowsOf(WORKFLOW_DEFINITIONS)]);
    const sync = new Map(syncRows.map((r) => [r.workflowCode, r]));
    const items = [...WORKFLOW_DEFINITIONS]
      .sort((a, b) => a.processId.localeCompare(b.processId))
      .map((f) => ({
        processId: f.processId,
        code: f.code,
        name: f.name,
        description: f.description,
        processType: f.processType,
        ownerDomain: f.ownerDomain,
        priority: f.priority,
        ownerRole: f.ownerRole,
        systems: f.systems,
        clients: [...new Set(f.stages.map((s) => s.client))],
        stageCount: f.stages.length,
        stepCount: f.stages.reduce((n, s) => n + s.steps.length, 0),
        documentation: docStatus(f, sync.get(f.code)),
        wiring: this.wiringSummary(f, flows),
        flowStats: this.flowStats(f, flows),
        hasInstances: f.instanceEntity?.system === 'ATLAS_BACKEND',
      }));
    const totals = {
      processes: items.length,
      documented: items.filter((i) => i.documentation.complete).length,
      fullyWired: items.filter((i) => i.wiring.unwired === 0 && i.wiring.unknown === 0).length,
      unwiredSteps: items.reduce((n, i) => n + i.wiring.unwired, 0),
    };
    return { totals, items };
  }

  async detail(code: string) {
    const f = this.find(code);
    const [syncRows, flows] = await Promise.all([this.repository.syncRows(), this.flowsOf([f])]);
    const sync = syncRows.find((r) => r.workflowCode === code);
    return {
      ...f,
      documentation: docStatus(f, sync),
      wiring: this.wiringSummary(f, flows),
      flowStats: this.flowStats(f, flows),
      codeHash: definitionHash(f),
      databaseHash: sync?.contentHash ?? null,
      stages: f.stages.map((s) => ({
        ...s,
        steps: s.steps.map((p) => {
          const { wiring, flow } = stepWiring(s, p, flows);
          return {
            ...p,
            kind: p.kind ?? 'http',
            system: p.system ?? 'ATLAS_BACKEND',
            wiring,
            flowId: flow?.flowId ?? null,
            verification: flow?.verification ?? null,
            risk: flow?.risk ?? null,
            testStatus: flow?.testStatus ?? null,
            callers: flow?.callers ?? [],
          };
        }),
      })),
    };
  }

  /** Sólo los pasos que ejecuta una persona en un portal: es lo que mide PROCESS_STEP_UNWIRED. */
  async wiring(code: string) {
    const f = this.find(code);
    const flows = await this.flowsOf([f]);
    const steps = f.stages.flatMap((s) =>
      s.steps
        .map((p) => ({ stage: s, step: p, ...stepWiring(s, p, flows) }))
        .filter((x) => x.wiring !== 'not_applicable')
        .map(({ stage, step, wiring, flow }) => ({
          stageCode: stage.code,
          stageName: stage.name,
          client: stage.client,
          screen: stage.screen ?? null,
          stepCode: step.code,
          stepName: step.name,
          method: step.method,
          path: step.path,
          system: step.system ?? 'ATLAS_BACKEND',
          wiring,
          callers: flow?.callers ?? [],
          flowId: flow?.flowId ?? null,
        })),
    );
    return { code, summary: this.wiringSummary(f, flows), steps };
  }

  async instances(code: string, tenantId: string, query: { status?: string; search?: string; page: number; pageSize: number }) {
    const f = this.find(code);
    const entity = f.instanceEntity;
    if (!entity || entity.system !== 'ATLAS_BACKEND') {
      return {
        supported: false as const,
        reason: entity
          ? `Las instancias viven en ${entity.system}; se consultan en su portal.`
          : 'Este proceso no declara dónde viven sus instancias.',
        entity: entity ?? null,
      };
    }
    const [byStatus, page] = await Promise.all([
      this.repository.countByStatus(entity, tenantId),
      this.repository.listInstances(entity, tenantId, {
        status: query.status,
        search: query.search,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
    ]);
    const open = new Set(entity.openStatuses ?? []);
    return {
      supported: true as const,
      entity,
      byStatus: byStatus.map((r) => ({ ...r, open: open.has(r.status) })),
      items: page.rows.map((r) => ({ ...r, open: open.has(r.status) })),
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Dónde va una instancia: las etapas cuyo estado de entrada o de salida coincide con el suyo. */
  async instanceProgress(code: string, tenantId: string, id: string) {
    const f = this.find(code);
    const entity = f.instanceEntity;
    if (!entity || entity.system !== 'ATLAS_BACKEND')
      throw new NotFoundException({ code: 'PROCESS_INSTANCES_NOT_HERE', message: 'Las instancias de este proceso no viven aquí.' });
    const instance = await this.repository.findInstance(entity, tenantId, id);
    if (!instance) throw new NotFoundException({ code: 'PROCESS_INSTANCE_NOT_FOUND', message: `No hay una instancia ${id} de ${code}.` });
    const stages = f.stages.map((s) => {
      const reached = (s.resultingStates ?? []).includes(instance.status);
      const current = (s.requiredStates ?? []).includes(instance.status);
      return {
        code: s.code,
        name: s.name,
        actor: s.actor,
        client: s.client,
        screen: s.screen ?? null,
        link: s.link ?? null,
        state: current ? 'current' : reached ? 'reached' : 'unknown',
      };
    });
    return { code, instance, stages };
  }
}
