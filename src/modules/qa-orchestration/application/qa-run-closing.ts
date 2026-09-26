/**
 * @file Servicio de aplicación: cierra una corrida QA — reconciliación, contadores y veredicto.
 * @business Esta pieza decide si la corrida pasó mirando lo persistido y lo que el mock VIO, no lo
 *   que el worker creyó; una expectativa de proveedor incumplida convierte el paso en FAILED.
 * @system escrituras cercadas por fencing: un worker sin lease no puede cerrar la corrida.
 */
import { Injectable } from '@nestjs/common';
import type { JourneyTemplate } from '../domain/journey-recipe.types.js';
import type { EffectivePlan } from '../domain/journey-plan.js';
import { reconcileJournal } from '../domain/journal-reconciliation.js';
import { countersFrom, emptyPersonaTally, emptyStepTally } from '../domain/run-accounting.js';
import type { QaPersonaStatus, QaRunCounters, QaRunStatus, QaRunVerdict, QaStepStatus } from '../domain/qa-run.types.js';
import { QaEnvironmentService } from './qa-environment.js';
import { QaRunQueryRepository } from '../infrastructure/qa-run-query.repository.js';
import { QaRunSupportRepository } from '../infrastructure/qa-run-support.repository.js';
import { QaRunWorkerRepository, type Fence, type PersonaCheckpoint } from '../infrastructure/qa-run-worker.repository.js';

export type RunContext = {
  runId: string;
  tenantId: string;
  fence: Fence;
  plan: EffectivePlan;
  template: JourneyTemplate;
  namespace: string;
  seed: string;
  referenceDate: string;
};

export type ExecutionOutcome =
  | { kind: 'FINISHED'; jobStatus: 'completed' | 'failed'; runStatus: QaRunStatus; verdict: QaRunVerdict | null }
  /** Apagado ordenado o lease perdido: la corrida sigue viva y otro worker la retoma. */
  | { kind: 'ABANDONED'; reason: string };

export type Closing = {
  status: QaRunStatus;
  verdict: QaRunVerdict | null;
  evidence: Record<string, unknown>;
  errorMessage?: string;
  requestsIssued?: number;
};

@Injectable()
export class QaRunClosing {
  constructor(
    private readonly runs: QaRunWorkerRepository,
    private readonly query: QaRunQueryRepository,
    private readonly environments: QaEnvironmentService,
    private readonly support: QaRunSupportRepository,
  ) {}

  async counters(runId: string, persons: number, requestsIssued: number): Promise<QaRunCounters> {
    const [personaRows, stepRows] = await Promise.all([this.query.personaTally(runId), this.query.stepTally(runId)]);
    const personas = emptyPersonaTally();
    for (const row of personaRows) personas[row.status as QaPersonaStatus] = Number(row.count);
    const steps = emptyStepTally();
    for (const row of stepRows) steps[row.status as QaStepStatus] += Number(row.count);
    return countersFrom({ personas, steps, requestsIssued, personsRequested: persons });
  }

  private async failViolatedSteps(
    ctx: RunContext,
    checkpoints: PersonaCheckpoint[],
    violations: ReturnType<typeof reconcileJournal>['violations'],
  ) {
    for (const violation of violations) {
      const checkpoint = checkpoints.find((candidate) => candidate.personaKey === violation.personaKey);
      const step = checkpoint?.steps.find((candidate) => candidate.stepKey === violation.stepKey);
      if (!checkpoint || !step) continue;
      const failures = [...step.failures, { code: 'ASSERTION_EQUALS_FAILED' as const, message: violation.message }];
      await this.runs.upsertStep(
        ctx.runId,
        checkpoint.personaRunId,
        { ...step, status: 'FAILED', reason: violation.message, failures },
        ctx.fence,
      );
      await this.runs.updatePersona(
        { personaRunId: checkpoint.personaRunId, status: 'FAILED', failedStepKey: step.stepKey, reason: violation.message, finish: true },
        ctx.fence,
      );
    }
  }

  /** Cruza el journal COMPLETO del mock con los pasos persistidos y cierra el namespace. */
  async reconcile(ctx: RunContext, namespaceOpened: boolean) {
    const journal = namespaceOpened ? await this.environments.mock.readJournal(ctx.tenantId, ctx.namespace).catch(() => null) : null;
    const checkpoints = await this.runs.loadCheckpoints(ctx.runId);
    const executed = checkpoints.flatMap((checkpoint) =>
      checkpoint.steps.map((step) => ({
        personaKey: checkpoint.personaKey,
        stepKey: step.stepKey,
        logicalOperationId: step.logicalOperationId,
        status: step.status,
      })),
    );
    const result = reconcileJournal({ template: ctx.template, executed, journal, namespaceOpened });
    await this.failViolatedSteps(ctx, checkpoints, result.violations);
    if (namespaceOpened) {
      await this.support.purgeSecret(ctx.runId);
      await this.environments.mock.closeRun(ctx.tenantId, ctx.namespace);
    }
    return {
      mockNamespace: namespaceOpened,
      mockConfirmed: result.mockConfirmed,
      providerCalls: result.providerCalls,
      unattributedCalls: result.unattributedCalls,
      violations: result.violations.slice(0, 50),
      detail: result.detail,
      journal: journal
        ? { totalAppended: journal.totalAppended, droppedByRetention: journal.droppedByRetention, complete: journal.complete }
        : null,
    };
  }

  async finish(ctx: Pick<RunContext, 'runId' | 'fence' | 'plan'>, closing: Closing): Promise<ExecutionOutcome> {
    const counters = await this.counters(ctx.runId, ctx.plan.persons, closing.requestsIssued ?? 0);
    const evidence = { ...closing.evidence, backendVersion: process.env.APP_VERSION ?? process.env.GIT_SHA ?? 'dev' };
    const confirmed = await this.runs.finishRun(
      { runId: ctx.runId, status: closing.status, verdict: closing.verdict, counters, evidence, errorMessage: closing.errorMessage },
      ctx.fence,
    );
    if (!confirmed) return { kind: 'ABANDONED', reason: 'LOST_LEASE' };
    await this.runs.appendEvent(ctx.runId, 'RUN_FINISHED', { status: closing.status, verdict: closing.verdict });
    return {
      kind: 'FINISHED',
      jobStatus: closing.status === 'FAILED_INFRASTRUCTURE' ? 'failed' : 'completed',
      runStatus: closing.status,
      verdict: closing.verdict,
    };
  }
}
