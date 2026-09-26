/**
 * @file Repositorio de persistencia: lecturas de corridas QA para el portal.
 * @business Esta pieza deja ver el progreso de una corrida desde cualquier pestaña o tras recargar,
 *   con la causa raíz antes que la cascada.
 * @system lecturas acotadas por tenant; nunca devuelven secretos (no leen `qa_run_secrets`).
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';

const S = atlasSchemaFor('qa_runs');

export type RunRow = {
  _id: string;
  _tenant_id: string;
  operator_id: string;
  status: string;
  verdict: string | null;
  template_code: string;
  template_version: string;
  workflow_code: string;
  environment_id: string;
  plan_hash: string;
  recipe_hash: string;
  plan_snapshot: Record<string, unknown>;
  seed: string;
  namespace: string;
  reference_date: string;
  generator_version: string;
  counters_json: Record<string, unknown>;
  evidence_json: Record<string, unknown>;
  requests_issued: number;
  error_message: string | null;
  cancel_requested_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  _created_at: Date;
  job_run_id: string | null;
};

export type PersonaRow = {
  ordinal: number;
  persona_key: string;
  status: string;
  case_category: string | null;
  archetype: string | null;
  resources_json: Record<string, unknown> | null;
  failed_step_key: string | null;
  reason: string | null;
  started_at: Date | null;
  finished_at: Date | null;
};

export type StepRow = {
  step_key: string;
  workflow_step_code: string | null;
  status: string;
  branch: string | null;
  reason: string | null;
  root_cause_step_key: string | null;
  failures_json: unknown;
  attempts_json: unknown;
  evidence_json: unknown;
  started_at: Date | null;
  finished_at: Date | null;
};

const RUN_COLUMNS = `_id, _tenant_id, operator_id, status, verdict, template_code, template_version, workflow_code, environment_id, plan_hash,
  recipe_hash, plan_snapshot, seed, namespace, reference_date::text AS reference_date, generator_version, counters_json, evidence_json,
  requests_issued, error_message, cancel_requested_at, started_at, finished_at, _created_at, job_run_id`;

@Injectable()
export class QaRunQueryRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async findRun(tenantId: string, runId: string): Promise<RunRow | null> {
    if (!/^\d+$/.test(runId)) return null;
    const rows = await this.sequelize.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM ${S}.qa_runs WHERE _id = $runId AND _tenant_id = $tenantId;`,
      {
        type: QueryTypes.SELECT,
        bind: { runId, tenantId },
      },
    );
    return rows[0] ?? null;
  }

  async listRuns(tenantId: string, input: { limit: number; templateCode?: string; workflowCode?: string }): Promise<RunRow[]> {
    return this.sequelize.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM ${S}.qa_runs
        WHERE _tenant_id = $tenantId
          AND ($templateCode::text IS NULL OR template_code = $templateCode)
          AND ($workflowCode::text IS NULL OR workflow_code = $workflowCode)
        ORDER BY _created_at DESC LIMIT $limit;`,
      {
        type: QueryTypes.SELECT,
        bind: { tenantId, limit: input.limit, templateCode: input.templateCode ?? null, workflowCode: input.workflowCode ?? null },
      },
    );
  }

  /** Conteo de pasos por estado, agregado en la base: no se cargan miles de filas para contarlas. */
  async stepTally(runId: string): Promise<Array<{ step_key: string; workflow_step_code: string | null; status: string; count: string }>> {
    return this.sequelize.query(
      `SELECT step_key, MAX(workflow_step_code) AS workflow_step_code, status, COUNT(*)::text AS count
         FROM ${S}.qa_step_runs WHERE run_id = $runId GROUP BY step_key, status;`,
      { type: QueryTypes.SELECT, bind: { runId } },
    );
  }

  async personaTally(runId: string): Promise<Array<{ status: string; count: string }>> {
    return this.sequelize.query(`SELECT status, COUNT(*)::text AS count FROM ${S}.qa_persona_runs WHERE run_id = $runId GROUP BY status;`, {
      type: QueryTypes.SELECT,
      bind: { runId },
    });
  }

  /** Fallos PROPIOS (no omisiones en cascada), agrupados: el error raíz antes que sus consecuencias. */
  async rootCauses(runId: string): Promise<Array<{ step_key: string; reason: string | null; personas: string }>> {
    return this.sequelize.query(
      `SELECT step_key, reason, COUNT(*)::text AS personas FROM ${S}.qa_step_runs
        WHERE run_id = $runId AND status IN ('FAILED', 'INDETERMINATE')
        GROUP BY step_key, reason ORDER BY COUNT(*) DESC LIMIT 10;`,
      { type: QueryTypes.SELECT, bind: { runId } },
    );
  }

  async listPersonas(runId: string, input: { page: number; limit: number; status?: string }) {
    const bind = { runId, status: input.status ?? null, limit: input.limit, offset: (input.page - 1) * input.limit };
    const [items, total] = await Promise.all([
      this.sequelize.query<PersonaRow>(
        `SELECT ordinal, persona_key, status, case_category, archetype, resources_json, failed_step_key, reason, started_at, finished_at
           FROM ${S}.qa_persona_runs WHERE run_id = $runId AND ($status::text IS NULL OR status = $status)
          ORDER BY ordinal LIMIT $limit OFFSET $offset;`,
        { type: QueryTypes.SELECT, bind },
      ),
      this.sequelize.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM ${S}.qa_persona_runs WHERE run_id = $runId AND ($status::text IS NULL OR status = $status);`,
        {
          type: QueryTypes.SELECT,
          bind,
        },
      ),
    ]);
    return { items, total: Number(total[0]?.total ?? 0) };
  }

  async listSteps(runId: string, personaKey: string) {
    return this.sequelize.query<StepRow>(
      `SELECT s.step_key, s.workflow_step_code, s.status, s.branch, s.reason, s.root_cause_step_key, s.failures_json, s.attempts_json,
              s.evidence_json, s.started_at, s.finished_at
         FROM ${S}.qa_step_runs s JOIN ${S}.qa_persona_runs p ON p._id = s.persona_run_id
        WHERE s.run_id = $runId AND p.persona_key = $personaKey ORDER BY s._id;`,
      { type: QueryTypes.SELECT, bind: { runId, personaKey } },
    );
  }

  async events(runId: string, after: number, limit = 200) {
    return this.sequelize.query<{ sequence: number; event_type: string; payload_json: unknown; _created_at: Date }>(
      `SELECT sequence, event_type, payload_json, _created_at FROM ${S}.qa_run_events WHERE run_id = $runId AND sequence > $after ORDER BY sequence LIMIT $limit;`,
      { type: QueryTypes.SELECT, bind: { runId, after, limit } },
    );
  }

  /** Endpoints de cada paso de un flujo del catálogo: con ellos se casan las recetas y el árbol. */
  async workflowEndpoints(workflowCode: string): Promise<Array<{ step_code: string; http_method: string; route_path: string }>> {
    return this.sequelize.query(
      `SELECT s.step_code, s.http_method, s.route_path
         FROM ${atlasSchemaFor('workflow_steps')}.workflow_steps s
         JOIN ${atlasSchemaFor('workflow_definitions')}.workflow_definitions d ON d._id = s.workflow_definition_id
        WHERE d.workflow_code = $workflowCode AND s._deleted = false;`,
      { type: QueryTypes.SELECT, bind: { workflowCode } },
    );
  }

  /** Workers QA con latido reciente: un proceso encendido que no consume la cola no cuenta. */
  async liveWorkers(withinSeconds: number): Promise<{ count: number; lastSeenAt: Date | null }> {
    const rows = await this.sequelize.query<{ count: string; last_seen: Date | null }>(
      `SELECT COUNT(*) FILTER (WHERE last_seen_at > now() - make_interval(secs => $within))::text AS count, MAX(last_seen_at) AS last_seen FROM ${S}.qa_worker_heartbeats;`,
      { type: QueryTypes.SELECT, bind: { within: withinSeconds } },
    );
    return { count: Number(rows[0]?.count ?? 0), lastSeenAt: rows[0]?.last_seen ?? null };
  }

  async activeRunsForTenant(tenantId: string): Promise<number> {
    const rows = await this.sequelize.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${S}.qa_runs WHERE _tenant_id = $tenantId AND status IN ('QUEUED','PREFLIGHT','RUNNING','CANCELLING');`,
      { type: QueryTypes.SELECT, bind: { tenantId } },
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Estado de la cola QA para `capabilities`: trabajo encolado y en vuelo. */
  async workerSnapshot(): Promise<{ queued: number; running: number; lastHeartbeatAt: Date | null }> {
    const rows = await this.sequelize.query<{ queued: string; running: string; last_heartbeat: Date | null }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'queued')::text AS queued,
              COUNT(*) FILTER (WHERE status = 'running' AND lease_expires_at > now())::text AS running,
              MAX(heartbeat_at) AS last_heartbeat
         FROM ${atlasSchemaFor('system_job_runs')}.system_job_runs WHERE job_code = 'systems_qa_journey_run';`,
      { type: QueryTypes.SELECT },
    );
    return {
      queued: Number(rows[0]?.queued ?? 0),
      running: Number(rows[0]?.running ?? 0),
      lastHeartbeatAt: rows[0]?.last_heartbeat ?? null,
    };
  }
}
