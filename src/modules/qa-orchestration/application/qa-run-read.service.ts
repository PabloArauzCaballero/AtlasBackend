/**
 * @file Servicio de aplicación: lecturas del laboratorio QA (catálogo, cobertura, corridas).
 * @business Esta pieza enseña lo que se puede ejecutar, lo que falta cubrir y cómo va cada corrida,
 *   sin que un conteo mienta: omitidos y sin-muestras se publican aparte.
 * @system arma las respuestas del contrato `docs/qa/contracts.md` a partir del catálogo y la base.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { FLUJO_CLIENTE_COMPLETO } from '../../../database/seeders/demo/flujo-cliente-completo.seed-data.js';
import { FLUJO_CLIENTE_PARTNER } from '../../../database/seeders/demo/flujo-cliente-partner.seed-data.js';
import { JOURNEY_CAMPAIGNS, JOURNEY_TEMPLATES, coverageMatrix, endpointKey, findTemplate } from '../catalog/journey-catalog.js';
import type { JourneyTemplate } from '../domain/journey-recipe.types.js';
import { buildPersona, PERSONA_GENERATOR_VERSION } from '../domain/persona-factory.js';
import { countersFrom, emptyPersonaTally } from '../domain/run-accounting.js';
import type { QaPersonaStatus } from '../domain/qa-run.types.js';
import { QaRunQueryRepository, type RunRow } from '../infrastructure/qa-run-query.repository.js';
import { actorOf } from './qa-run-orchestrator.service.js';
import { summary, tallySteps } from './qa-run-read.mappers.js';
import { QaWorkflowMatcher } from './qa-workflow-matcher.js';
import { qaError } from './qa-errors.js';

/** Lo que el plan congelado guarda y la API repite en cada cabecera de corrida. */
type PlanSnapshot = { mode?: string; persons?: number; concurrency?: number; scenarioCode?: string; datasetMode?: string };

const INVENTORIES: Record<string, string[]> = Object.fromEntries(
  [FLUJO_CLIENTE_COMPLETO, FLUJO_CLIENTE_PARTNER].map((flujo) => [
    flujo.code,
    flujo.stages.flatMap((stage) => stage.steps.map((step) => step.code)),
  ]),
);

@Injectable()
export class QaRunReadService {
  constructor(
    private readonly query: QaRunQueryRepository,
    private readonly matcher: QaWorkflowMatcher,
  ) {}

  /**
   * Con `workflowCode`, sólo las plantillas que recorren algún paso de ESE flujo, casadas por
   * endpoint (los códigos de paso difieren entre flujos; la ruta que llaman, no).
   */
  async templates(workflowCode?: string) {
    // Sin flujo no hay «pasos de este flujo» que contar: el campo se omite en vez de decir 0.
    if (!workflowCode) return { items: JOURNEY_TEMPLATES.map(summary) };
    const items = [];
    for (const template of JOURNEY_TEMPLATES) {
      const matchedStepCodes = await this.matcher.matchedSteps(template, workflowCode);
      if (matchedStepCodes.length > 0) items.push({ ...summary(template), matchedStepCodes });
    }
    return { items };
  }

  template(code: string, version: string) {
    const template = findTemplate(code, version);
    if (!template) throw new NotFoundException(qaError('QA_TEMPLATE_NOT_FOUND'));
    return {
      ...summary(template),
      steps: template.steps.map((step, index) => ({
        stepKey: step.stepKey,
        workflowStepCode: step.workflowStepCode ?? null,
        method: step.method,
        path: step.path,
        endpoint: endpointKey(step.method, step.path),
        actor: step.actor,
        dependsOn: step.dependsOn ?? (index === 0 ? [] : [template.steps[index - 1].stepKey]),
        expectStatus: step.expect.status,
        branches: (step.branches ?? []).map((branch) => ({ label: branch.label, status: branch.status })),
        providers: step.providers ?? [],
        rateLimit: step.rateLimit,
      })),
    };
  }

  campaigns() {
    return { items: JOURNEY_CAMPAIGNS };
  }

  coverage(workflowCode?: string) {
    const codes = workflowCode ? INVENTORIES[workflowCode] : Object.values(INVENTORIES).flat();
    if (!codes) throw new NotFoundException(qaError('QA_WORKFLOW_NOT_FOUND'));
    const rows = coverageMatrix(codes);
    const byReason: Record<string, number> = {};
    for (const row of rows) if (row.gapReason) byReason[row.gapReason] = (byReason[row.gapReason] ?? 0) + 1;
    const covered = rows.filter((row) => row.status === 'COVERED').length;
    return { rows, summary: { total: rows.length, covered, gaps: rows.length - covered, byReason } };
  }

  /** Datos de muestra: NO crea usuarios, no escribe nada y no contacta a nadie. El PIN no sale. */
  sampleInputs(code: string, version: string, input: { seed: string; count: number; datasetMode: string }) {
    const template = findTemplate(code, version);
    if (!template) throw new NotFoundException(qaError('QA_TEMPLATE_NOT_FOUND'));
    if (!template.datasetModes.includes(input.datasetMode as JourneyTemplate['datasetModes'][number]))
      throw new BadRequestException(qaError('QA_DATASET_MODE_UNSUPPORTED'));
    const refDate = new Date();
    const personas = Array.from({ length: input.count }, (_, index) => {
      const persona = buildPersona({ masterSeed: input.seed, ordinal: index + 1, refDate, runNamespace: 'preview' });
      const { pin: _pin, deviceFingerprintHash: _device, ...visible } = persona;
      return visible;
    });
    return { generatorVersion: PERSONA_GENERATOR_VERSION, datasetMode: input.datasetMode, personas };
  }

  private async requireRun(user: AuthenticatedUser, runId: string): Promise<RunRow> {
    const { tenantId } = actorOf(user);
    // Otro tenant recibe el mismo 404 que un id inexistente: no se confirma que la corrida exista.
    const run = await this.query.findRun(tenantId, runId);
    if (!run) throw new NotFoundException(qaError('QA_RUN_NOT_FOUND'));
    return run;
  }

  async runs(user: AuthenticatedUser, input: { limit: number; templateCode?: string; workflowCode?: string }) {
    const { tenantId } = actorOf(user);
    const rows = await this.query.listRuns(tenantId, input);
    return { items: rows.map((row) => this.header(row)) };
  }

  private header(row: RunRow) {
    const plan = row.plan_snapshot as PlanSnapshot;
    return {
      runId: String(row._id),
      status: row.status,
      verdict: row.verdict,
      templateCode: row.template_code,
      templateVersion: row.template_version,
      workflowCode: row.workflow_code,
      environmentId: row.environment_id,
      mode: plan.mode,
      persons: plan.persons,
      concurrency: plan.concurrency,
      seed: row.seed,
      scenarioCode: plan.scenarioCode,
      datasetMode: plan.datasetMode,
      createdAt: new Date(row._created_at).toISOString(),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
      cancelRequestedAt: row.cancel_requested_at ? new Date(row.cancel_requested_at).toISOString() : null,
      operatorId: row.operator_id,
      errorMessage: row.error_message,
    };
  }

  async run(user: AuthenticatedUser, runId: string) {
    const row = await this.requireRun(user, runId);
    const [personaRows, stepRows, causes] = await Promise.all([
      this.query.personaTally(runId),
      this.query.stepTally(runId),
      this.query.rootCauses(runId),
    ]);
    const personas = emptyPersonaTally();
    for (const entry of personaRows) personas[entry.status as QaPersonaStatus] = Number(entry.count);
    const { steps, byStep } = tallySteps(stepRows, findTemplate(row.template_code, row.template_version));
    const plan = row.plan_snapshot as PlanSnapshot;
    const counters = countersFrom({ personas, steps, requestsIssued: row.requests_issued, personsRequested: Number(plan.persons) });
    const evidence = row.evidence_json;
    return {
      ...this.header(row),
      counters,
      steps: [...byStep.values()],
      rootCauses: causes.map((cause) => ({
        stepKey: cause.step_key,
        reason: cause.reason ?? 'sin detalle',
        personas: Number(cause.personas),
      })),
      evidence: {
        mockNamespace: evidence.mockNamespace === true,
        mockConfirmed: typeof evidence.mockConfirmed === 'boolean' ? evidence.mockConfirmed : null,
        providerCalls: typeof evidence.providerCalls === 'number' ? evidence.providerCalls : null,
        detail: typeof evidence.detail === 'string' ? evidence.detail : 'La evidencia del mock se reconcilia al terminar la corrida.',
      },
    };
  }

  async personas(user: AuthenticatedUser, runId: string, input: { page: number; limit: number; status?: string }) {
    await this.requireRun(user, runId);
    const result = await this.query.listPersonas(runId, input);
    return {
      items: result.items.map((item) => ({
        ordinal: item.ordinal,
        personaKey: item.persona_key,
        status: item.status,
        caseCategory: item.case_category,
        archetype: item.archetype,
        resources: item.resources_json ?? {},
        failedStepKey: item.failed_step_key,
        reason: item.reason,
        startedAt: item.started_at,
        finishedAt: item.finished_at,
      })),
      total: result.total,
      page: input.page,
      limit: input.limit,
    };
  }

  async steps(user: AuthenticatedUser, runId: string, personaKey: string) {
    await this.requireRun(user, runId);
    const rows = await this.query.listSteps(runId, personaKey);
    return {
      items: rows.map((row) => ({
        stepKey: row.step_key,
        workflowStepCode: row.workflow_step_code,
        status: row.status,
        branch: row.branch,
        reason: row.reason,
        rootCauseStepKey: row.root_cause_step_key,
        failures: row.failures_json,
        attempts: row.attempts_json,
        evidence: row.evidence_json,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      })),
    };
  }

  async events(user: AuthenticatedUser, runId: string, after: number) {
    await this.requireRun(user, runId);
    const rows = await this.query.events(runId, after);
    return {
      items: rows.map((row) => ({
        sequence: Number(row.sequence),
        type: row.event_type,
        payload: row.payload_json,
        createdAt: new Date(row._created_at).toISOString(),
      })),
      nextCursor: rows.length > 0 ? Number(rows[rows.length - 1].sequence) : after,
    };
  }

  async evidence(user: AuthenticatedUser, runId: string) {
    const row = await this.requireRun(user, runId);
    const detail = await this.run(user, runId);
    return {
      runId,
      planHash: row.plan_hash.trim(),
      recipeHash: row.recipe_hash.trim(),
      generatorVersion: row.generator_version,
      seed: row.seed,
      namespace: row.namespace,
      referenceDate: row.reference_date,
      plan: row.plan_snapshot,
      counters: detail.counters,
      verdict: row.verdict,
      steps: detail.steps,
      evidence: row.evidence_json,
    };
  }
}
