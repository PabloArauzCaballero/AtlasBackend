/**
 * @file Repositorio de persistencia: planes de preflight y admisión transaccional de corridas QA.
 * @business Esta pieza garantiza que «en ejecución» sólo se anuncia si la corrida Y su trabajo
 *   quedaron encolados, y que un doble click no lanza dos corridas.
 * @system corrida + personas + job + evento en UNA transacción; idempotencia por tenant+operador+clave.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import type { EffectivePlan } from '../domain/journey-plan.js';

export const QA_JOURNEY_JOB_CODE = 'systems_qa_journey_run';

const S = atlasSchemaFor('qa_runs');
const JOBS = `${atlasSchemaFor('system_job_runs')}.system_job_runs`;

export type StoredPlan = { planId: string; tenantId: string; operatorId: string; planHash: string; plan: EffectivePlan; expiresAt: Date };

export type AdmissionInput = {
  tenantId: string;
  operatorId: string;
  idempotencyKey: string;
  planId: string;
  planHash: string;
  plan: EffectivePlan;
  workflowCode: string;
  namespace: string;
  referenceDate: string;
};

export type AdmissionResult = { runId: string; status: string; replayed: boolean } | { conflict: 'IDEMPOTENCY_KEY_REUSED' };

@Injectable()
export class QaRunAdmissionRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async savePlan(input: { tenantId: string; operatorId: string; planHash: string; plan: EffectivePlan; expiresAt: Date }): Promise<string> {
    const rows = await this.sequelize.query<{ _id: string }>(
      `INSERT INTO ${S}.qa_run_plans (_tenant_id, operator_id, plan_hash, plan_json, expires_at)
       VALUES ($tenantId, $operatorId, $planHash, $plan, $expiresAt) RETURNING _id;`,
      { type: QueryTypes.SELECT, bind: { ...input, plan: JSON.stringify(input.plan) } },
    );
    return String(rows[0]._id);
  }

  async findPlan(planId: string, tenantId: string): Promise<StoredPlan | null> {
    const rows = await this.sequelize.query<{
      _id: string;
      _tenant_id: string;
      operator_id: string;
      plan_hash: string;
      plan_json: EffectivePlan;
      expires_at: Date;
    }>(
      `SELECT _id, _tenant_id, operator_id, plan_hash, plan_json, expires_at FROM ${S}.qa_run_plans WHERE _id = $planId AND _tenant_id = $tenantId;`,
      { type: QueryTypes.SELECT, bind: { planId, tenantId } },
    );
    const row = rows[0];
    if (!row) return null;
    return {
      planId: String(row._id),
      tenantId: String(row._tenant_id),
      operatorId: row.operator_id,
      planHash: row.plan_hash.trim(),
      plan: row.plan_json,
      expiresAt: new Date(row.expires_at),
    };
  }

  async findByIdempotencyKey(input: Pick<AdmissionInput, 'tenantId' | 'operatorId' | 'idempotencyKey'>) {
    return this.findByKey(input);
  }

  private async findByKey(input: Pick<AdmissionInput, 'tenantId' | 'operatorId' | 'idempotencyKey'>, transaction?: Transaction) {
    const rows = await this.sequelize.query<{ _id: string; plan_hash: string; status: string }>(
      `SELECT _id, plan_hash, status FROM ${S}.qa_runs WHERE _tenant_id = $tenantId AND operator_id = $operatorId AND idempotency_key = $idempotencyKey;`,
      {
        type: QueryTypes.SELECT,
        bind: { tenantId: input.tenantId, operatorId: input.operatorId, idempotencyKey: input.idempotencyKey },
        transaction,
      },
    );
    return rows[0] ?? null;
  }

  private replayOrConflict(existing: { _id: string; plan_hash: string; status: string }, planHash: string): AdmissionResult {
    if (existing.plan_hash.trim() !== planHash) return { conflict: 'IDEMPOTENCY_KEY_REUSED' };
    return { runId: String(existing._id), status: existing.status, replayed: true };
  }

  /**
   * Corrida, personas, job y primer evento en la misma transacción. Si cualquiera falla no queda
   * una corrida huérfana que el portal enseñe «en cola» sin que nadie la vaya a ejecutar.
   *
   * Dos lanzamientos concurrentes con la misma clave: el índice único decide, y el perdedor relee
   * la corrida del ganador en vez de propagar el error de unicidad (A29).
   */
  async admit(input: AdmissionInput): Promise<AdmissionResult> {
    const existing = await this.findByKey(input);
    if (existing) return this.replayOrConflict(existing, input.planHash);
    try {
      return await this.sequelize.transaction(async (transaction) => {
        const runs = await this.sequelize.query<{ _id: string }>(
          `INSERT INTO ${S}.qa_runs (_tenant_id, operator_id, idempotency_key, plan_id, plan_hash, plan_snapshot, recipe_hash,
             template_code, template_version, workflow_code, environment_id, status, seed, namespace, reference_date, generator_version, counters_json)
           VALUES ($tenantId, $operatorId, $idempotencyKey, $planId, $planHash, $plan, $recipeHash, $templateCode, $templateVersion,
             $workflowCode, $environmentId, 'QUEUED', $seed, $namespace, $referenceDate, $generatorVersion, $counters)
           RETURNING _id;`,
          {
            type: QueryTypes.SELECT,
            transaction,
            bind: {
              tenantId: input.tenantId,
              operatorId: input.operatorId,
              idempotencyKey: input.idempotencyKey,
              planId: input.planId,
              planHash: input.planHash,
              plan: JSON.stringify(input.plan),
              recipeHash: input.plan.recipeHash,
              templateCode: input.plan.templateCode,
              templateVersion: input.plan.templateVersion,
              workflowCode: input.workflowCode,
              environmentId: input.plan.environmentId,
              seed: input.plan.seed,
              namespace: input.namespace,
              referenceDate: input.referenceDate,
              generatorVersion: input.plan.generatorVersion,
              counters: JSON.stringify({ personsRequested: input.plan.persons, personsPending: input.plan.persons }),
            },
          },
        );
        const runId = String(runs[0]._id);
        await this.sequelize.query(
          `INSERT INTO ${S}.qa_persona_runs (run_id, ordinal, persona_key)
           SELECT $runId, ordinal, 'p-' || lpad(ordinal::text, 4, '0') FROM generate_series(1, $persons::int) AS ordinal;`,
          { transaction, bind: { runId, persons: input.plan.persons } },
        );
        const jobs = await this.sequelize.query<{ _id: string }>(
          `INSERT INTO ${JOBS} (_tenant_id, job_code, status, input_json, triggered_by_type, triggered_by_id, _created_at)
           VALUES ($tenantId, '${QA_JOURNEY_JOB_CODE}', 'queued', $input, 'internal_user', $operatorId, now()) RETURNING _id;`,
          {
            type: QueryTypes.SELECT,
            transaction,
            bind: { tenantId: input.tenantId, operatorId: input.operatorId, input: JSON.stringify({ qaRunId: runId }) },
          },
        );
        await this.sequelize.query(`UPDATE ${S}.qa_runs SET job_run_id = $jobId WHERE _id = $runId;`, {
          transaction,
          bind: { jobId: jobs[0]._id, runId },
        });
        await this.sequelize.query(
          `INSERT INTO ${S}.qa_run_events (run_id, sequence, event_type, payload_json) VALUES ($runId, 1, 'RUN_QUEUED', $payload);`,
          { transaction, bind: { runId, payload: JSON.stringify({ persons: input.plan.persons, concurrency: input.plan.concurrency }) } },
        );
        return { runId, status: 'QUEUED', replayed: false };
      });
    } catch (error) {
      if (
        (error as { name?: string }).name !== 'SequelizeUniqueConstraintError' &&
        !/ux_qa_runs_idempotency/.test(String((error as Error).message))
      )
        throw error;
      const winner = await this.findByKey(input);
      if (!winner) throw error;
      return this.replayOrConflict(winner, input.planHash);
    }
  }

  /**
   * Idempotente: cancelar dos veces, o una corrida ya terminada, no cambia nada.
   *
   * Una corrida que ningún worker tomó todavía se cierra aquí mismo —no generó tráfico—; una en
   * vuelo pasa a CANCELLING y la cierra el worker cuando deja de admitir y reconcilia lo aceptado.
   */
  async requestCancel(tenantId: string, runId: string): Promise<{ status: string } | null> {
    return this.sequelize.transaction(async (transaction) => {
      const rows = await this.sequelize.query<{ status: string }>(
        `UPDATE ${S}.qa_runs
            SET cancel_requested_at = COALESCE(cancel_requested_at, now()),
                status = CASE WHEN status = 'QUEUED' THEN 'CANCELLED'
                              WHEN status IN ('PREFLIGHT','RUNNING') THEN 'CANCELLING' ELSE status END,
                finished_at = CASE WHEN status = 'QUEUED' THEN now() ELSE finished_at END,
                _updated_at = now()
          WHERE _id = $runId AND _tenant_id = $tenantId
      RETURNING status;`,
        { type: QueryTypes.SELECT, bind: { runId, tenantId }, transaction },
      );
      const row = rows[0];
      if (row?.status === 'CANCELLED') {
        await this.sequelize.query(
          `UPDATE ${S}.qa_persona_runs SET status = 'CANCELLED', reason = 'corrida cancelada antes de empezar' WHERE run_id = $runId AND status = 'PENDING';`,
          {
            bind: { runId },
            transaction,
          },
        );
      }
      return row ?? null;
    });
  }
}
