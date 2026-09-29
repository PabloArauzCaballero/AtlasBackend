/**
 * @file Búsqueda de personas de una corrida QA contra PostgreSQL real.
 * @business El buscador de la tabla de personas del portal busca en TODAS las personas de la corrida,
 *   no sólo en la página que se ve, y `%` o `_` escritos por la persona no son comodines.
 * @system `QaRunQueryRepository.listPersonas` con `q` sobre `qa_persona_runs` (ILIKE con el patrón
 *   escapado de `containsLikePattern` y número de orden exacto).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../../../src/database/domain-schemas.js';
import { QaRunAdmissionRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-admission.repository.js';
import { QaRunQueryRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-query.repository.js';
import type { EffectivePlan } from '../../../src/modules/qa-orchestration/domain/journey-plan.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

const S = atlasSchemaFor('qa_runs');
let database: IntegrationDatabase | null = null;
let runId = '';

const plan: EffectivePlan = {
  templateCode: 'account_signup_to_login',
  templateVersion: '1.0.0',
  recipeHash: 'r'.repeat(64),
  workflowCode: 'customer_full_lifecycle',
  environmentId: 'qa-local',
  mode: 'INTEGRATED_QA',
  persons: 4,
  concurrency: 1,
  seed: 'integration',
  datasetMode: 'NORMAL_SYNTHETIC',
  scenarioCode: 'happy_path',
  limits: { maxRequests: 100, maxDurationMs: 60_000, maxInFlightRequests: 2 },
  generatorVersion: 'persona-factory@1',
  estimatedRequests: 16,
  estimatedAdmissionMs: 0,
  stepCount: 4,
  providers: [],
};

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  const tenants = await database.sequelize.query<{ _id: string }>(
    `SELECT _id FROM ${atlasSchemaFor('tenants')}.tenants ORDER BY _id LIMIT 1;`,
    {
      type: QueryTypes.SELECT,
    },
  );
  const result = await new QaRunAdmissionRepository(database.sequelize).admit({
    tenantId: String(tenants[0]?._id ?? '1'),
    operatorId: 'op-it',
    idempotencyKey: `k-${runToken()}`,
    planId: '1',
    planHash: 'e'.repeat(64),
    plan,
    workflowCode: 'customer_full_lifecycle',
    namespace: `qa-it-${runToken()}`,
    referenceDate: '2026-09-29',
  });
  if (!('runId' in result)) throw new Error('no se admitió');
  runId = result.runId;
  // Cuatro personas distinguibles por cada campo que el buscador recorre.
  const rows: Array<[number, string, string, string | null, string | null]> = [
    [1, 'asalariado', 'normal', null, null],
    [2, 'independiente', 'frontera', 'signup', '422 VALIDATION_ERROR'],
    [3, 'jubilado', 'normal', 'login', 'usa 50% del cupo y user_id vacío'],
    [4, 'estudiante', 'error', 'signup', 'timeout del proveedor'],
  ];
  for (const [ordinal, archetype, category, failedStep, reason] of rows) {
    await database.sequelize.query(
      `UPDATE ${S}.qa_persona_runs SET archetype = $archetype, case_category = $category, failed_step_key = $failedStep, reason = $reason
        WHERE run_id = $runId AND ordinal = $ordinal;`,
      { bind: { runId, ordinal, archetype, category, failedStep, reason } },
    );
  }
});

afterAll(async () => {
  if (database && runId) {
    await database.sequelize.query(`DELETE FROM ${S}.qa_runs WHERE _id = $id;`, { bind: { id: runId } });
    await database.sequelize.query(
      `DELETE FROM ${atlasSchemaFor('system_job_runs')}.system_job_runs WHERE job_code = 'systems_qa_journey_run' AND input_json->>'qaRunId' = $id;`,
      { bind: { id: runId } },
    );
  }
  await database?.close();
});

async function ordinals(input: {
  q?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{ ordinals: number[]; total: number }> {
  const query = new QaRunQueryRepository(database!.sequelize);
  const result = await query.listPersonas(runId, { page: input.page ?? 1, limit: input.limit ?? 50, status: input.status, q: input.q });
  return { ordinals: result.items.map((item) => Number(item.ordinal)), total: result.total };
}

describe('búsqueda de personas de una corrida (q)', () => {
  it('sin q devuelve todas', async () => {
    if (!database) return;
    expect(await ordinals({})).toEqual({ ordinals: [1, 2, 3, 4], total: 4 });
  });

  it('busca por parte del arquetipo, la categoría, el paso que falló y el motivo, sin distinguir mayúsculas', async () => {
    if (!database) return;
    expect((await ordinals({ q: 'INDEPEN' })).ordinals).toEqual([2]);
    expect((await ordinals({ q: 'frontera' })).ordinals).toEqual([2]);
    expect((await ordinals({ q: 'login' })).ordinals).toEqual([3]);
    expect((await ordinals({ q: 'timeout' })).ordinals).toEqual([4]);
    expect((await ordinals({ q: 'signup' })).ordinals).toEqual([2, 4]);
  });

  it('busca por la clave de la persona y por su número de orden', async () => {
    if (!database) return;
    const key = await database.sequelize.query<{ persona_key: string }>(
      `SELECT persona_key FROM ${S}.qa_persona_runs WHERE run_id = $runId AND ordinal = 3;`,
      { type: QueryTypes.SELECT, bind: { runId } },
    );
    expect((await ordinals({ q: key[0].persona_key })).ordinals).toContain(3);
    expect((await ordinals({ q: '#3' })).ordinals).toContain(3);
    expect((await ordinals({ q: '#3' })).ordinals).not.toContain(4);
  });

  it('%, _ y \\ escritos por la persona se buscan como texto, no como comodines', async () => {
    if (!database) return;
    // Sin escapar, «%» casaría con las cuatro y «_» con cualquier carácter.
    expect((await ordinals({ q: '50%' })).ordinals).toEqual([3]);
    expect((await ordinals({ q: '%' })).ordinals).toEqual([3]);
    expect((await ordinals({ q: 'user_id' })).ordinals).toEqual([3]);
    expect((await ordinals({ q: 'user_i_' })).ordinals).toEqual([]);
    expect((await ordinals({ q: '\\' })).ordinals).toEqual([]);
  });

  it('el total y la paginación cuentan sólo lo que coincide, y q se combina con status', async () => {
    if (!database) return;
    expect(await ordinals({ q: 'signup', limit: 1, page: 2 })).toEqual({ ordinals: [4], total: 2 });
    await database!.sequelize.query(`UPDATE ${S}.qa_persona_runs SET status = 'FAILED' WHERE run_id = $runId AND ordinal = 2;`, {
      bind: { runId },
    });
    expect(await ordinals({ q: 'signup', status: 'FAILED' })).toEqual({ ordinals: [2], total: 1 });
    expect(await ordinals({ q: 'nadie coincide' })).toEqual({ ordinals: [], total: 0 });
  });
});
