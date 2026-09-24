/**
 * @file Repositorio de persistencia: escrituras del worker QA, cercadas por fencing.
 * @business Esta pieza hace que un worker que perdió su lease no pueda cerrar ni pisar la corrida
 *   que otro worker ya retomó.
 * @system cada escritura lleva en su `WHERE` el token de fencing vigente del job; cero filas =
 *   ya no es el dueño.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import type { StepRecord } from '../application/executor.ports.js';
import type { StepRow } from './qa-run-query.repository.js';

const S = atlasSchemaFor('qa_runs');
const JOBS = `${atlasSchemaFor('system_job_runs')}.system_job_runs`;

export type Fence = { jobRunId: string; fencingToken: string };

const FENCED = `EXISTS (SELECT 1 FROM ${JOBS} j WHERE j._id = $jobRunId AND j.fencing_token = $fencingToken AND j.status = 'running')`;

export type PersonaCheckpoint = {
  personaRunId: string;
  ordinal: number;
  personaKey: string;
  status: string;
  resources: Record<string, unknown>;
  steps: StepRecord[];
};

@Injectable()
export class QaRunWorkerRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  private async fenced(sql: string, bind: Record<string, unknown>, fence: Fence): Promise<number> {
    const rows = await this.sequelize.query<{ ok: number }>(`${sql} RETURNING 1 AS ok;`, {
      type: QueryTypes.SELECT,
      bind: { ...bind, ...fence },
    });
    return rows.length;
  }

  async loadRun(runId: string) {
    const rows = await this.sequelize.query<{
      _id: string;
      _tenant_id: string;
      status: string;
      plan_snapshot: Record<string, unknown>;
      namespace: string;
      reference_date: string;
      seed: string;
      cancel_requested_at: Date | null;
      job_run_id: string;
    }>(
      `SELECT _id, _tenant_id, status, plan_snapshot, namespace, reference_date::text AS reference_date, seed, cancel_requested_at, job_run_id FROM ${S}.qa_runs WHERE _id = $runId;`,
      { type: QueryTypes.SELECT, bind: { runId } },
    );
    return rows[0] ?? null;
  }

  async isCancelRequested(runId: string): Promise<boolean> {
    const rows = await this.sequelize.query<{ c: Date | null }>(`SELECT cancel_requested_at AS c FROM ${S}.qa_runs WHERE _id = $runId;`, {
      type: QueryTypes.SELECT,
      bind: { runId },
    });
    return Boolean(rows[0]?.c);
  }

  async markRunning(runId: string, fence: Fence): Promise<boolean> {
    return (
      (await this.fenced(
        `UPDATE ${S}.qa_runs SET status = 'RUNNING', started_at = COALESCE(started_at, now()), _updated_at = now() WHERE _id = $runId AND status IN ('QUEUED','RUNNING') AND ${FENCED}`,
        { runId },
        fence,
      )) === 1
    );
  }

  /** Checkpoint de todas las personas: los pasos confirmados no se repiten al retomar. */
  async loadCheckpoints(runId: string): Promise<PersonaCheckpoint[]> {
    const personas = await this.sequelize.query<{
      _id: string;
      ordinal: number;
      persona_key: string;
      status: string;
      resources_json: Record<string, unknown>;
    }>(`SELECT _id, ordinal, persona_key, status, resources_json FROM ${S}.qa_persona_runs WHERE run_id = $runId ORDER BY ordinal;`, {
      type: QueryTypes.SELECT,
      bind: { runId },
    });
    const steps = await this.sequelize.query<StepRow & { persona_run_id: string; visit_index: number; logical_operation_id: string }>(
      `SELECT persona_run_id, step_key, workflow_step_code, visit_index, logical_operation_id, status, branch, reason, root_cause_step_key,
              failures_json, attempts_json, evidence_json, started_at, finished_at
         FROM ${S}.qa_step_runs WHERE run_id = $runId ORDER BY _id;`,
      { type: QueryTypes.SELECT, bind: { runId } },
    );
    return personas.map((persona) => ({
      personaRunId: String(persona._id),
      ordinal: Number(persona.ordinal),
      personaKey: persona.persona_key,
      status: persona.status,
      resources: persona.resources_json ?? {},
      steps: steps
        .filter((step) => String(step.persona_run_id) === String(persona._id))
        .map((step) => ({
          stepKey: step.step_key,
          workflowStepCode: step.workflow_step_code ?? undefined,
          visitIndex: Number(step.visit_index),
          logicalOperationId: String(step.logical_operation_id).trim(),
          status: step.status as StepRecord['status'],
          branch: step.branch ?? undefined,
          reason: step.reason ?? undefined,
          rootCauseStepKey: step.root_cause_step_key ?? undefined,
          failures: (step.failures_json ?? []) as StepRecord['failures'],
          attempts: (step.attempts_json ?? []) as StepRecord['attempts'],
          evidence: (step.evidence_json ?? {}) as StepRecord['evidence'],
          startedAt: step.started_at ? new Date(step.started_at).toISOString() : '',
          finishedAt: step.finished_at ? new Date(step.finished_at).toISOString() : '',
        })),
    }));
  }

  async updatePersona(
    input: {
      personaRunId: string;
      status: string;
      resources?: Record<string, unknown>;
      failedStepKey?: string | null;
      reason?: string | null;
      caseCategory?: string;
      archetype?: string;
      datasetHash?: string;
      start?: boolean;
      finish?: boolean;
    },
    fence: Fence,
  ): Promise<boolean> {
    return (
      (await this.fenced(
        `UPDATE ${S}.qa_persona_runs SET status = $status,
            resources_json = COALESCE($resources::jsonb, resources_json),
            failed_step_key = CASE WHEN $finish THEN $failedStepKey ELSE failed_step_key END,
            reason = CASE WHEN $finish THEN $reason ELSE reason END,
            case_category = COALESCE($caseCategory, case_category), archetype = COALESCE($archetype, archetype),
            dataset_hash = COALESCE($datasetHash, dataset_hash),
            started_at = CASE WHEN $start THEN COALESCE(started_at, now()) ELSE started_at END,
            finished_at = CASE WHEN $finish THEN now() ELSE finished_at END
          WHERE _id = $personaRunId AND ${FENCED}`,
        {
          personaRunId: input.personaRunId,
          status: input.status,
          resources: input.resources === undefined ? null : JSON.stringify(input.resources),
          failedStepKey: input.failedStepKey ?? null,
          reason: input.reason ?? null,
          caseCategory: input.caseCategory ?? null,
          archetype: input.archetype ?? null,
          datasetHash: input.datasetHash ?? null,
          start: input.start === true,
          finish: input.finish === true,
        },
        fence,
      )) === 1
    );
  }

  async mergeResources(personaRunId: string, resources: Record<string, unknown>, fence: Fence): Promise<void> {
    await this.fenced(
      `UPDATE ${S}.qa_persona_runs SET resources_json = resources_json || $resources::jsonb WHERE _id = $personaRunId AND ${FENCED}`,
      { personaRunId, resources: JSON.stringify(resources) },
      fence,
    );
  }

  /** Un paso por (persona, step, visita). Reescribirlo es idempotente: la última versión manda. */
  async upsertStep(runId: string, personaRunId: string, step: StepRecord, fence: Fence): Promise<boolean> {
    return (
      (await this.fenced(
        `INSERT INTO ${S}.qa_step_runs (persona_run_id, run_id, step_key, workflow_step_code, visit_index, logical_operation_id, status, branch, reason,
            root_cause_step_key, failures_json, attempts_json, evidence_json, started_at, finished_at)
         SELECT $personaRunId, $runId, $stepKey, $workflowStepCode, $visitIndex, $operationId, $status, $branch, $reason, $rootCause, $failures, $attempts, $evidence, $startedAt, $finishedAt
          WHERE ${FENCED}
         ON CONFLICT (persona_run_id, step_key, visit_index) DO UPDATE SET status = EXCLUDED.status, branch = EXCLUDED.branch, reason = EXCLUDED.reason,
            root_cause_step_key = EXCLUDED.root_cause_step_key, failures_json = EXCLUDED.failures_json, attempts_json = EXCLUDED.attempts_json,
            evidence_json = EXCLUDED.evidence_json, finished_at = EXCLUDED.finished_at`,
        {
          personaRunId,
          runId,
          stepKey: step.stepKey,
          workflowStepCode: step.workflowStepCode ?? null,
          visitIndex: step.visitIndex,
          operationId: step.logicalOperationId,
          status: step.status,
          branch: step.branch ?? null,
          reason: step.reason ?? null,
          rootCause: step.rootCauseStepKey ?? null,
          failures: JSON.stringify(step.failures),
          attempts: JSON.stringify(step.attempts),
          evidence: JSON.stringify(step.evidence),
          startedAt: step.startedAt || null,
          finishedAt: step.finishedAt || null,
        },
        fence,
      )) === 1
    );
  }

  /**
   * Secuencia monótona por corrida. Varias personas terminan a la vez y cada una añade su evento:
   * se serializan con el bloqueo de la fila de la corrida, en vez de competir por `MAX(sequence)+1`
   * y perder contra el índice único (medido con 5 personas: un choque tumbó el job entero).
   */
  async appendEvent(runId: string, type: string, payload: Record<string, unknown>): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query(`SELECT _id FROM ${S}.qa_runs WHERE _id = $runId FOR UPDATE;`, { bind: { runId }, transaction });
      await this.sequelize.query(
        `INSERT INTO ${S}.qa_run_events (run_id, sequence, event_type, payload_json)
         SELECT $runId, COALESCE(MAX(sequence), 0) + 1, $type, $payload FROM ${S}.qa_run_events WHERE run_id = $runId;`,
        { bind: { runId, type, payload: JSON.stringify(payload) }, transaction },
      );
    });
  }

  async addRequests(runId: string, count: number): Promise<void> {
    await this.sequelize.query(
      `UPDATE ${S}.qa_runs SET requests_issued = requests_issued + $count, _updated_at = now() WHERE _id = $runId;`,
      { bind: { runId, count } },
    );
  }

  async finishRun(
    input: {
      runId: string;
      status: string;
      verdict: string | null;
      counters: Record<string, unknown>;
      evidence: Record<string, unknown>;
      errorMessage?: string | null;
    },
    fence: Fence,
  ): Promise<boolean> {
    return (
      (await this.fenced(
        `UPDATE ${S}.qa_runs SET status = $status, verdict = $verdict, counters_json = $counters, evidence_json = $evidence,
            error_message = $errorMessage, finished_at = now(), _updated_at = now()
          WHERE _id = $runId AND ${FENCED}`,
        {
          runId: input.runId,
          status: input.status,
          verdict: input.verdict,
          counters: JSON.stringify(input.counters),
          evidence: JSON.stringify(input.evidence),
          errorMessage: input.errorMessage ?? null,
        },
        fence,
      )) === 1
    );
  }

  async requestsIssued(runId: string): Promise<number> {
    const rows = await this.sequelize.query<{ n: number }>(`SELECT requests_issued AS n FROM ${S}.qa_runs WHERE _id = $runId;`, {
      type: QueryTypes.SELECT,
      bind: { runId },
    });
    return Number(rows[0]?.n ?? 0);
  }

  async saveProgress(runId: string, counters: Record<string, unknown>): Promise<void> {
    await this.sequelize.query(`UPDATE ${S}.qa_runs SET counters_json = $counters, _updated_at = now() WHERE _id = $runId;`, {
      bind: { runId, counters: JSON.stringify(counters) },
    });
  }

  /** Personas que siguen pendientes al cerrar: se bloquean con motivo para que el conteo cuadre. */
  async closePendingPersonas(runId: string, status: 'BLOCKED' | 'CANCELLED', reason: string, fence: Fence): Promise<void> {
    await this.fenced(
      `UPDATE ${S}.qa_persona_runs SET status = $status, reason = $reason, finished_at = now() WHERE run_id = $runId AND status IN ('PENDING','RUNNING') AND ${FENCED}`,
      { runId, status, reason },
      fence,
    );
  }

  async recordResource(
    runId: string,
    input: { personaKey: string; service: string; resourceType: string; resourceId: string },
  ): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO ${S}.qa_run_resources (run_id, persona_key, service, resource_type, resource_id) VALUES ($runId, $personaKey, $service, $resourceType, $resourceId)
       ON CONFLICT DO NOTHING;`,
      { bind: { runId, ...input } },
    );
  }
}
