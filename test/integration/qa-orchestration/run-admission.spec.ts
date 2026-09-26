/**
 * @file Admisión y eventos de corridas QA contra PostgreSQL real.
 * @business Un doble click no lanza dos corridas, la misma clave con otro plan se rechaza, otro
 *   tenant no ve la corrida, y varias personas que terminan a la vez no tumban la corrida.
 * @system `QaRunAdmissionRepository` + `QaRunWorkerRepository` sobre las tablas `qa_*` reales.
 *   El choque de eventos concurrentes se midió en vivo el 24-sep-2026 (5 personas: un
 *   `SequelizeUniqueConstraintError` mató el job y dejó la corrida en RUNNING para siempre).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../../../src/database/domain-schemas.js';
import { QaRunAdmissionRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-admission.repository.js';
import { QaRunQueryRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-query.repository.js';
import { QaRunWorkerRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-worker.repository.js';
import type { EffectivePlan } from '../../../src/modules/qa-orchestration/domain/journey-plan.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

const S = atlasSchemaFor('qa_runs');
let database: IntegrationDatabase | null = null;
const created: string[] = [];

const plan = (persons: number): EffectivePlan => ({
  templateCode: 'account_signup_to_login',
  templateVersion: '1.0.0',
  recipeHash: 'r'.repeat(64),
  workflowCode: 'customer_full_lifecycle',
  environmentId: 'qa-local',
  mode: 'INTEGRATED_QA',
  persons,
  concurrency: 1,
  seed: 'integration',
  datasetMode: 'NORMAL_SYNTHETIC',
  scenarioCode: 'happy_path',
  limits: { maxRequests: 100, maxDurationMs: 60_000, maxInFlightRequests: 2 },
  generatorVersion: 'persona-factory@1',
  estimatedRequests: 4 * persons,
  estimatedAdmissionMs: 0,
  stepCount: 4,
  providers: [],
});

beforeAll(async () => {
  database = await openIntegrationDatabase();
});

afterAll(async () => {
  if (database && created.length > 0) {
    await database.sequelize.query(`DELETE FROM ${S}.qa_runs WHERE _id = ANY($ids::bigint[]);`, { bind: { ids: created } });
    await database.sequelize.query(
      `DELETE FROM ${atlasSchemaFor('system_job_runs')}.system_job_runs WHERE job_code = 'systems_qa_journey_run' AND input_json->>'qaRunId' = ANY($ids::text[]);`,
      { bind: { ids: created } },
    );
  }
  await database?.close();
});

async function tenantId(): Promise<string> {
  const rows = await database!.sequelize.query<{ _id: string }>(
    `SELECT _id FROM ${atlasSchemaFor('tenants')}.tenants ORDER BY _id LIMIT 1;`,
    {
      type: QueryTypes.SELECT,
    },
  );
  return String(rows[0]?._id ?? '1');
}

describe('admisión de corridas QA', () => {
  it('misma clave y mismo plan devuelven la misma corrida aunque lleguen a la vez (A29)', async () => {
    if (!database) return;
    const admission = new QaRunAdmissionRepository(database.sequelize);
    const tenant = await tenantId();
    const input = {
      tenantId: tenant,
      operatorId: 'op-it',
      idempotencyKey: `k-${runToken()}`,
      planId: '1',
      planHash: 'a'.repeat(64),
      plan: plan(3),
      workflowCode: 'customer_full_lifecycle',
      namespace: `qa-it-${runToken()}`,
      referenceDate: '2026-09-24',
    };
    const [first, second] = await Promise.all([admission.admit(input), admission.admit(input)]);
    expect('runId' in first && 'runId' in second && first.runId === second.runId).toBe(true);
    if ('runId' in first) created.push(first.runId);
    const personas = await database.sequelize.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ${S}.qa_persona_runs WHERE run_id = $id;`,
      {
        type: QueryTypes.SELECT,
        bind: { id: 'runId' in first ? first.runId : '0' },
      },
    );
    expect(personas[0].n).toBe('3');
    expect(await admission.admit({ ...input, planHash: 'b'.repeat(64) })).toEqual({ conflict: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('otro tenant no ve la corrida (A21)', async () => {
    if (!database) return;
    const admission = new QaRunAdmissionRepository(database.sequelize);
    const query = new QaRunQueryRepository(database.sequelize);
    const tenant = await tenantId();
    const result = await admission.admit({
      tenantId: tenant,
      operatorId: 'op-it',
      idempotencyKey: `k-${runToken()}`,
      planId: '1',
      planHash: 'c'.repeat(64),
      plan: plan(1),
      workflowCode: 'customer_full_lifecycle',
      namespace: `qa-it-${runToken()}`,
      referenceDate: '2026-09-24',
    });
    if (!('runId' in result)) throw new Error('no se admitió');
    created.push(result.runId);
    expect(await query.findRun(tenant, result.runId)).not.toBeNull();
    expect(await query.findRun('999999999', result.runId)).toBeNull();
  });

  it('veinte eventos simultáneos quedan con secuencia 1..N sin chocar', async () => {
    if (!database) return;
    const admission = new QaRunAdmissionRepository(database.sequelize);
    const worker = new QaRunWorkerRepository(database.sequelize);
    const result = await admission.admit({
      tenantId: await tenantId(),
      operatorId: 'op-it',
      idempotencyKey: `k-${runToken()}`,
      planId: '1',
      planHash: 'd'.repeat(64),
      plan: plan(1),
      workflowCode: 'customer_full_lifecycle',
      namespace: `qa-it-${runToken()}`,
      referenceDate: '2026-09-24',
    });
    if (!('runId' in result)) throw new Error('no se admitió');
    created.push(result.runId);
    await Promise.all(Array.from({ length: 20 }, (_, index) => worker.appendEvent(result.runId, 'PERSONA_FINISHED', { index })));
    const rows = await database.sequelize.query<{ sequence: number }>(
      `SELECT sequence FROM ${S}.qa_run_events WHERE run_id = $id ORDER BY sequence;`,
      {
        type: QueryTypes.SELECT,
        bind: { id: result.runId },
      },
    );
    expect(rows.map((row) => Number(row.sequence))).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
  });
});
