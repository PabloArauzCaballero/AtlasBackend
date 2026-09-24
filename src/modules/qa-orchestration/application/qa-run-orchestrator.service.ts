/**
 * @file Servicio de aplicación: control de corridas QA (preflight, lanzamiento, cancelación).
 * @business Esta pieza convierte «Ejecutar flujo con N personas» en una corrida durable: responde
 *   con un runId en vez de generar tráfico desde el navegador.
 * @system tenant y operador salen de la sesión; el plan congelado se revalida al ejecutar.
 */
import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { findTemplate, recipeHash } from '../catalog/journey-catalog.js';
import { compilePlan, type EffectivePlan } from '../domain/journey-plan.js';
import { PERSONA_GENERATOR_VERSION } from '../domain/persona-factory.js';
import type { QaRunRequest } from '../domain/qa-run.types.js';
import { QaRunAdmissionRepository } from '../infrastructure/qa-run-admission.repository.js';
import { QaRunQueryRepository } from '../infrastructure/qa-run-query.repository.js';
import { QaEnvironmentService } from './qa-environment.js';
import { QaWorkflowMatcher } from './qa-workflow-matcher.js';
import { qaError } from './qa-errors.js';

const PLAN_TTL_MS = 15 * 60_000;
/** Rollout inicial: una corrida activa por tenant; las siguientes esperan a que termine. */
const MAX_ACTIVE_RUNS_PER_TENANT = 1;

export function actorOf(user: AuthenticatedUser): { tenantId: string; operatorId: string } {
  if (!user.tenantId) throw new ForbiddenException(qaError('QA_TENANT_REQUIRED'));
  return { tenantId: String(user.tenantId), operatorId: String(user.internalUserId ?? user.platformUserId ?? user.sub) };
}

@Injectable()
export class QaRunOrchestratorService {
  constructor(
    private readonly environments: QaEnvironmentService,
    private readonly admission: QaRunAdmissionRepository,
    private readonly query: QaRunQueryRepository,
    private readonly matcher: QaWorkflowMatcher,
  ) {}

  async capabilities() {
    const [readiness, mock, queue] = await Promise.all([
      this.environments.readiness(),
      this.environments.mockCapabilities(),
      this.query.workerSnapshot(),
    ]);
    const reason = this.environments.disabledReason();
    return {
      enabled: reason === null,
      disabledReason: reason,
      deploymentEnvironment: this.environments.environments()[0].deploymentEnvironment,
      generatorVersion: PERSONA_GENERATOR_VERSION,
      environments: reason === null ? this.environments.environments() : [],
      worker: {
        ready: readiness.workerReady,
        lastHeartbeatAt: readiness.lastWorkerSeenAt,
        activeRuns: queue.running,
        queuedRuns: queue.queued,
      },
      mock: { reachable: mock.reachable, schemaVersion: mock.schemaVersion, controlPlane: this.environments.mock.configured },
    };
  }

  async preflight(user: AuthenticatedUser, request: QaRunRequest) {
    const { tenantId, operatorId } = actorOf(user);
    const template = findTemplate(request.templateCode, request.templateVersion);
    const readiness = await this.environments.readiness();
    const disabled = this.environments.disabledReason();
    const result = compilePlan({
      request,
      template,
      recipeHash: template ? recipeHash(template) : null,
      environment: this.environments.environment(request.environmentId),
      readiness,
      generatorVersion: PERSONA_GENERATOR_VERSION,
    });
    if (disabled) result.blockers.unshift({ code: 'UNSAFE_ENVIRONMENT', message: disabled });
    // Lanzar desde un árbol exige que la plantilla recorra algún paso de ESE flujo.
    if (template && request.workflowCode && (await this.matcher.matchedSteps(template, request.workflowCode)).length === 0) {
      result.blockers.push({
        code: 'INVALID_INPUT',
        message: `La plantilla no recorre ningún paso del flujo ${request.workflowCode}.`,
        subject: 'workflowCode',
      });
    }
    if (result.status !== 'READY' || !result.plan || !result.planHash || result.blockers.length > 0) {
      return { status: 'BLOCKED' as const, blockers: result.blockers, plan: null, planId: null, planHash: null, expiresAt: null };
    }
    const expiresAt = new Date(Date.now() + PLAN_TTL_MS);
    const planId = await this.admission.savePlan({ tenantId, operatorId, planHash: result.planHash, plan: result.plan, expiresAt });
    return {
      status: 'READY' as const,
      blockers: [],
      plan: result.plan,
      planId,
      planHash: result.planHash,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * 202 sólo si la corrida quedó encolada. Revalida lo que pudo cambiar desde el preflight: la
   * receta (hash), el plazo del plan, el worker y el entorno. Una receta editada no se ejecuta con
   * el plan viejo, y una corrida aceptada conserva su snapshot aunque la receta cambie después.
   */
  async launch(user: AuthenticatedUser, input: { planId: string; planHash: string; idempotencyKey: string }) {
    const { tenantId, operatorId } = actorOf(user);
    const stored = await this.admission.findPlan(input.planId, tenantId);
    if (!stored || stored.operatorId !== operatorId) throw new NotFoundException(qaError('QA_PLAN_NOT_FOUND'));
    if (stored.planHash !== input.planHash) throw new ConflictException(qaError('PLAN_CHANGED'));
    if (stored.expiresAt.getTime() < Date.now()) throw new ConflictException(qaError('PLAN_EXPIRED'));
    const plan: EffectivePlan = stored.plan;
    const template = findTemplate(plan.templateCode, plan.templateVersion);
    if (!template || recipeHash(template) !== plan.recipeHash) throw new ConflictException(qaError('PLAN_CHANGED'));
    const disabled = this.environments.disabledReason();
    if (disabled) throw new ServiceUnavailableException(qaError('QA_DISABLED', disabled));
    const readiness = await this.environments.readiness();
    if (!readiness.workerReady) throw new ServiceUnavailableException(qaError('WORKER_UNAVAILABLE'));

    // El reintento de un lanzamiento ya aceptado (misma clave) no es una segunda corrida activa.
    const previous = await this.admission.findByIdempotencyKey({ tenantId, operatorId, idempotencyKey: input.idempotencyKey });
    if (!previous && (await this.query.activeRunsForTenant(tenantId)) >= MAX_ACTIVE_RUNS_PER_TENANT) {
      throw new ConflictException(qaError('QA_RUN_ALREADY_ACTIVE'));
    }
    const runNonce =
      input.idempotencyKey
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(-8)
        .toLowerCase() || 'x';
    const result = await this.admission.admit({
      tenantId,
      operatorId,
      idempotencyKey: input.idempotencyKey,
      planId: input.planId,
      planHash: input.planHash,
      plan,
      workflowCode: plan.workflowCode ?? template.workflowCode,
      // Namespace NUEVO por corrida: la misma semilla reproduce las mismas personas con
      // identificadores operacionales que no chocan con los de la corrida anterior.
      namespace: `qa-${Date.now().toString(36)}-${runNonce}`,
      referenceDate: new Date().toISOString().slice(0, 10),
    });
    if ('conflict' in result) throw new ConflictException(qaError(result.conflict));
    return { runId: result.runId, status: result.status };
  }

  async cancel(user: AuthenticatedUser, runId: string) {
    const { tenantId } = actorOf(user);
    if (!/^\d+$/.test(runId)) throw new NotFoundException(qaError('QA_RUN_NOT_FOUND'));
    const result = await this.admission.requestCancel(tenantId, runId);
    if (!result) throw new NotFoundException(qaError('QA_RUN_NOT_FOUND'));
    return { runId, status: result.status };
  }
}
