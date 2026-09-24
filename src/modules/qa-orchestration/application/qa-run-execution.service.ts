/**
 * @file Servicio de aplicación: ejecuta UNA corrida QA reclamada, de las fixtures al veredicto.
 * @business Esta pieza hace que N personas recorran su flujo en paralelo acotado, con su propia
 *   sesión, y que el resultado se decida con evidencia del mock y no por códigos HTTP sueltos.
 * @system checkpoint por paso, cancelación y plazo observados, reconciliación con el journal.
 */
import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../../config/env.js';
import { encryptSecret } from '../../../common/utils/crypto/secret-box.util.js';
import { deploymentEnvironment, QA_EXECUTION_HEADER, signQaCredential } from '../../../platform/security/qa-execution-context.js';
import { findTemplate, recipeHash } from '../catalog/journey-catalog.js';
import { buildPersona } from '../domain/persona-factory.js';
import { personaOutcome, runVerdict } from '../domain/run-accounting.js';
import type { QaRunStatus } from '../domain/qa-run.types.js';
import { QaEnvironmentService } from './qa-environment.js';
import { JourneyExecutor } from './journey-executor.js';
import { requestedAmountFor, resolveFixtures } from './qa-run-fixtures.js';
import { QaRunClosing, type ExecutionOutcome, type RunContext } from './qa-run-closing.js';
import { abortableSleep, BucketAdmission, QaHttpTransport, RunBudget } from '../infrastructure/qa-http-actor.js';
import { QaRunSupportRepository } from '../infrastructure/qa-run-support.repository.js';
import { QaRunWorkerRepository, type Fence, type PersonaCheckpoint } from '../infrastructure/qa-run-worker.repository.js';

export type { ExecutionOutcome } from './qa-run-closing.js';

const TERMINAL_RUN: readonly string[] = ['COMPLETED', 'CANCELLED', 'BLOCKED', 'FAILED_INFRASTRUCTURE', 'TIMED_OUT'];
const TERMINAL_PERSONA: readonly string[] = ['PASSED', 'FAILED', 'BLOCKED', 'INDETERMINATE', 'CANCELLED'];

type Runtime = { controller: AbortController; budget: RunBudget; transport: QaHttpTransport; fixtures: Record<string, unknown> };

@Injectable()
export class QaRunExecutionService {
  private readonly logger = new Logger(QaRunExecutionService.name);

  constructor(
    private readonly runs: QaRunWorkerRepository,
    private readonly environments: QaEnvironmentService,
    private readonly closing: QaRunClosing,
    private readonly support: QaRunSupportRepository,
  ) {}

  /** Cierre por un fallo inesperado del worker: personas en vuelo bloqueadas y la corrida terminal. */
  async failInfrastructure(runId: string, fence: Fence, message: string): Promise<void> {
    const run = await this.runs.loadRun(runId);
    if (!run || TERMINAL_RUN.includes(run.status)) return;
    await this.runs.closePendingPersonas(runId, 'BLOCKED', `fallo del worker: ${message}`, fence);
    const plan = run.plan_snapshot as unknown as RunContext['plan'];
    await this.closing.finish(
      { runId, fence, plan },
      { status: 'FAILED_INFRASTRUCTURE', verdict: null, evidence: {}, errorMessage: message },
    );
  }

  /** Carga la corrida y comprueba que la receta congelada sigue siendo la publicada. */
  private async load(runId: string, fence: Fence): Promise<RunContext | ExecutionOutcome> {
    const run = await this.runs.loadRun(runId);
    if (!run) throw new Error(`QA_RUN_NOT_FOUND:${runId}`);
    if (TERMINAL_RUN.includes(run.status))
      return { kind: 'FINISHED', jobStatus: 'completed', runStatus: run.status as QaRunStatus, verdict: null };
    const plan = run.plan_snapshot as unknown as RunContext['plan'];
    const template = findTemplate(plan.templateCode, plan.templateVersion);
    if (!template || recipeHash(template) !== plan.recipeHash) {
      const errorMessage = 'La receta congelada ya no coincide con la publicada; hace falta un preflight nuevo.';
      return this.closing.finish({ runId, fence, plan }, { status: 'BLOCKED', verdict: null, evidence: {}, errorMessage });
    }
    return {
      runId,
      tenantId: String(run._tenant_id),
      fence,
      plan,
      template,
      namespace: run.namespace,
      seed: run.seed,
      referenceDate: run.reference_date,
    };
  }

  async execute(runId: string, fence: Fence, signal: AbortSignal): Promise<ExecutionOutcome> {
    const loaded = await this.load(runId, fence);
    if ('kind' in loaded) return loaded;
    const ctx = loaded;
    if (deploymentEnvironment() === 'PROD' || !env.QA_TARGET_BASE_URL || !env.QA_EXECUTION_SECRET) {
      const errorMessage = this.environments.disabledReason() ?? 'Entorno no apto para QA.';
      return this.closing.finish(ctx, { status: 'BLOCKED', verdict: null, evidence: {}, errorMessage });
    }
    // Un apagado o un lease perdido ANTES de empezar: `addEventListener` no avisa de una señal ya
    // abortada, así que sin esta comprobación la corrida entera se ejecutaría ignorando el apagado.
    if (signal.aborted) return { kind: 'ABANDONED', reason: String(signal.reason ?? 'SHUTDOWN') };
    if (!(await this.runs.markRunning(runId, fence))) return { kind: 'ABANDONED', reason: 'LOST_LEASE' };
    await this.runs.appendEvent(runId, 'RUN_STARTED', { persons: ctx.plan.persons, concurrency: ctx.plan.concurrency });

    // Una sola señal para cancelar, vencer el plazo o apagar; el motivo decide cómo se cierra.
    const controller = new AbortController();
    const stop = (reason: string) => !controller.signal.aborted && controller.abort(reason);
    const onAbort = () => stop(String(signal.reason ?? 'SHUTDOWN'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    const deadlineAt = Date.now() + ctx.plan.limits.maxDurationMs;
    const watcher = setInterval(() => {
      if (Date.now() >= deadlineAt) stop('TIMED_OUT');
      void this.runs.isCancelRequested(runId).then(
        (requested) => requested && stop('CANCELLED'),
        () => undefined,
      );
    }, 2_000);
    watcher.unref();
    try {
      return await this.runWithRuntime(ctx, controller, deadlineAt);
    } finally {
      clearInterval(watcher);
    }
  }

  private async runWithRuntime(ctx: RunContext, controller: AbortController, deadlineAt: number): Promise<ExecutionOutcome> {
    const namespaceOpened = await this.openMockNamespace(ctx);
    if (!namespaceOpened && ctx.plan.mode === 'INTEGRATED_QA' && ctx.plan.providers.length > 0) {
      const errorMessage = 'No se pudo abrir el namespace de la corrida en el mock de proveedores.';
      const evidence = { mockNamespace: false, mockConfirmed: false };
      return this.closing.finish(ctx, { status: 'FAILED_INFRASTRUCTURE', verdict: null, evidence, errorMessage });
    }
    const transport = new QaHttpTransport(env.QA_TARGET_BASE_URL as string, ctx.tenantId);
    const fixtures = await resolveFixtures(ctx.template, {
      transport,
      signal: controller.signal,
      creditProduct: () => (env.QA_TARGET_SHARES_DATABASE ? this.support.findActiveCreditProduct(ctx.tenantId) : Promise.resolve(null)),
    });
    const { maxRequests, maxInFlightRequests } = ctx.plan.limits;
    const budget = new RunBudget({ maxRequests, maxInFlightRequests, deadlineAt }, controller.signal);
    controller.signal.addEventListener('abort', () => budget.wakeAll(), { once: true });
    // Fixture «faltante» porque la corrida se abortó mientras se resolvía: no es un bloqueo, se
    // cierra (o se abandona) por el motivo del aborto.
    if (!fixtures.ok && controller.signal.aborted)
      return this.conclude(ctx, { controller, budget, transport, fixtures: {} }, namespaceOpened);
    if (!fixtures.ok) {
      await this.runs.closePendingPersonas(ctx.runId, 'BLOCKED', fixtures.message, ctx.fence);
      const evidence = { mockNamespace: namespaceOpened };
      return this.closing.finish(ctx, { status: 'BLOCKED', verdict: null, evidence, errorMessage: `FIXTURE_MISSING: ${fixtures.message}` });
    }
    const runtime: Runtime = { controller, budget, transport, fixtures: fixtures.fixtures };
    await this.runPersonas(ctx, runtime);
    return this.conclude(ctx, runtime, namespaceOpened);
  }

  private pendingReason(reason: string | null, budget: RunBudget): string | null {
    if (reason === 'CANCELLED') return 'corrida cancelada';
    if (reason === 'TIMED_OUT') return 'se agotó el plazo de la corrida';
    return budget.exhausted === 'BUDGET_EXHAUSTED' ? 'se agotó el presupuesto de solicitudes' : null;
  }

  private async conclude(ctx: RunContext, runtime: Runtime, namespaceOpened: boolean): Promise<ExecutionOutcome> {
    const { controller, budget } = runtime;
    const reason = controller.signal.aborted ? String(controller.signal.reason) : null;
    if (reason === 'SHUTDOWN' || reason === 'LOST_LEASE') return { kind: 'ABANDONED', reason };
    const pendingReason = this.pendingReason(reason, budget);
    if (pendingReason)
      await this.runs.closePendingPersonas(ctx.runId, reason === 'CANCELLED' ? 'CANCELLED' : 'BLOCKED', pendingReason, ctx.fence);

    const evidence = await this.closing.reconcile(ctx, namespaceOpened);
    const requestsIssued = await this.runs.requestsIssued(ctx.runId);
    const counters = await this.closing.counters(ctx.runId, ctx.plan.persons, requestsIssued);
    const externalEvidenceMissing = ctx.plan.mode === 'INTEGRATED_QA' && ctx.plan.providers.length > 0 && evidence.mockConfirmed !== true;
    const status: QaRunStatus = reason === 'CANCELLED' ? 'CANCELLED' : reason === 'TIMED_OUT' ? 'TIMED_OUT' : 'COMPLETED';
    const verdict =
      status === 'COMPLETED' ? runVerdict(counters, { externalEvidenceMissing }) : counters.personsFailed > 0 ? 'FAILED' : 'INCONCLUSIVE';
    const errorMessage = budget.exhausted === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED' : undefined;
    return this.closing.finish(ctx, { status, verdict, evidence, errorMessage, requestsIssued });
  }

  /** Personas pendientes en carriles: `concurrency` a la vez, cada una con su ejecutor y su sink. */
  private async runPersonas(ctx: RunContext, runtime: Runtime): Promise<void> {
    const pending = (await this.runs.loadCheckpoints(ctx.runId)).filter((checkpoint) => !TERMINAL_PERSONA.includes(checkpoint.status));
    const admission = new BucketAdmission();
    let cursor = 0;
    const lane = async () => {
      while (cursor < pending.length && !runtime.controller.signal.aborted) {
        const checkpoint = pending[cursor++];
        await this.runPersona(ctx, runtime, checkpoint, this.executorFor(ctx, runtime, admission, checkpoint.personaRunId));
      }
    };
    await Promise.all(Array.from({ length: Math.min(ctx.plan.concurrency, Math.max(1, pending.length)) }, lane));
  }

  /**
   * Un ejecutor por persona, con su sink: persiste CADA paso al terminarlo (y la escritura
   * anticipada RUNNING de las mutaciones), y lleva los recursos extraídos al checkpoint para que un
   * reinicio no pida un customerId nuevo.
   */
  private executorFor(ctx: RunContext, runtime: Runtime, admission: BucketAdmission, personaRunId: string): JourneyExecutor {
    const secret = env.QA_EXECUTION_SECRET as string;
    const environment = deploymentEnvironment();
    return new JourneyExecutor({
      transport: runtime.transport,
      admission,
      budget: runtime.budget,
      sleep: abortableSleep,
      credential: {
        headerFor: ({ personaKey, logicalOperationId, attempt }) => ({
          [QA_EXECUTION_HEADER]: signQaCredential(
            { tenantId: ctx.tenantId, runId: ctx.runId, personaKey, logicalOperationId, attempt, environment },
            secret,
          ),
        }),
      },
      sink: {
        record: async (step) => {
          await this.runs.upsertStep(ctx.runId, personaRunId, step, ctx.fence);
          // Las solicitudes se cuentan al cerrar cada paso y quedan en la base: si el worker muere, el
          // que retoma suma las suyas a las del anterior en vez de empezar de cero.
          if (step.status !== 'RUNNING' && step.attempts.length > 0) await this.runs.addRequests(ctx.runId, step.attempts.length);
          const extracted = Object.entries(step.evidence.extracted ?? {}).filter(([key]) => key.startsWith('resources.'));
          if (step.status !== 'PASSED' || extracted.length === 0) return;
          const resources = Object.fromEntries(extracted.map(([key, value]) => [key.slice('resources.'.length), value]));
          await this.runs.mergeResources(personaRunId, resources, ctx.fence);
        },
      },
    });
  }

  private personaScope(ctx: RunContext, runtime: Runtime, checkpoint: PersonaCheckpoint) {
    const refDate = new Date(`${ctx.referenceDate}T12:00:00Z`);
    const persona = buildPersona({ masterSeed: ctx.seed, ordinal: checkpoint.ordinal, refDate, runNamespace: ctx.namespace });
    const product = runtime.fixtures.creditProduct as { minAmount: number; maxAmount: number } | undefined;
    return {
      persona,
      scope: {
        persona: { ...persona, requestedAmount: requestedAmountFor(persona.monthlyIncome, product) },
        fixtures: runtime.fixtures,
        run: {
          runId: ctx.runId,
          namespace: ctx.namespace,
          seed: ctx.seed,
          referenceDate: ctx.referenceDate,
          scenarioCode: ctx.plan.scenarioCode,
        },
        resources: { ...checkpoint.resources } as Record<string, unknown>,
        session: {} as Record<string, Record<string, unknown>>,
      },
    };
  }

  private async runPersona(ctx: RunContext, runtime: Runtime, checkpoint: PersonaCheckpoint, executor: JourneyExecutor): Promise<void> {
    const { persona, scope } = this.personaScope(ctx, runtime, checkpoint);
    const personaRunId = checkpoint.personaRunId;
    await this.runs.updatePersona(
      { personaRunId, status: 'RUNNING', start: true, caseCategory: persona.caseCategory, archetype: persona.archetype },
      ctx.fence,
    );
    const records = await executor.run({
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      personaKey: checkpoint.personaKey,
      template: ctx.template,
      scope,
      completed: new Map(checkpoint.steps.map((step) => [step.stepKey, step])),
      resumed: checkpoint.steps.length > 0,
      signal: runtime.controller.signal,
      defaultTimeoutMs: 15_000,
    });
    const reason = runtime.controller.signal.aborted ? String(runtime.controller.signal.reason) : null;
    if (reason === 'SHUTDOWN' || reason === 'LOST_LEASE') return;
    const status = personaOutcome(records.map((record) => record.status));
    const failed = records.find((record) => record.status === 'FAILED' || record.status === 'INDETERMINATE');
    const resources = Object.fromEntries(Object.entries(scope.resources).filter(([, value]) => typeof value !== 'object'));
    await this.runs.updatePersona(
      { personaRunId, status, resources, failedStepKey: failed?.stepKey ?? null, reason: failed?.reason ?? null, finish: true },
      ctx.fence,
    );
    await this.runs.appendEvent(ctx.runId, 'PERSONA_FINISHED', {
      personaKey: checkpoint.personaKey,
      status,
      failedStepKey: failed?.stepKey ?? null,
    });
  }

  private async openMockNamespace(ctx: RunContext): Promise<boolean> {
    if (!this.environments.mock.configured) return false;
    if ((await this.support.readSecret(ctx.runId))?.token) return true;
    try {
      const opened = await this.environments.mock.openRun({
        tenantId: ctx.tenantId,
        runId: ctx.namespace,
        seed: ctx.plan.seed,
        scenarioProfile: ctx.plan.scenarioCode,
      });
      const expiresAt = new Date(Date.now() + ctx.plan.limits.maxDurationMs + 3_600_000);
      await this.support.saveSecret(ctx.runId, encryptSecret(opened.runToken), opened.epoch, expiresAt);
      await this.runs.appendEvent(ctx.runId, 'MOCK_NAMESPACE_OPENED', { namespace: ctx.namespace, epoch: opened.epoch });
      return true;
    } catch (error) {
      this.logger.warn(`No se pudo abrir el namespace del mock para la corrida ${ctx.runId}: ${(error as Error).message}`);
      return false;
    }
  }
}
