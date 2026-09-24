import type { Sequelize } from 'sequelize-typescript';
import {
  QaRunAdmissionRepository,
  type AdmissionInput,
} from '../../../src/modules/qa-orchestration/infrastructure/qa-run-admission.repository';
import { QaRunQueryRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-query.repository';
import { QaRunSupportRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-support.repository';
import { QaRunWorkerRepository } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-worker.repository';
import type { EffectivePlan } from '../../../src/modules/qa-orchestration/domain/journey-plan';
import type { StepRecord } from '../../../src/modules/qa-orchestration/application/executor.ports';

type QueryOptions = { bind?: Record<string, unknown>; transaction?: unknown; type?: string };
type Call = { sql: string; options: QueryOptions };
type Responder = (sql: string, options: QueryOptions) => unknown;

/**
 * Doble de `sequelize`: registra cada consulta y responde según el SQL. La transacción entrega un
 * objeto propio para poder comprobar que las escrituras de la admisión viajan DENTRO de ella.
 */
function fakeSequelize(responder: Responder = () => []) {
  const calls: Call[] = [];
  const transactionHandle = { id: 'tx-1' };
  const sequelize = {
    query: jest.fn(async (sql: string, options: QueryOptions = {}) => {
      calls.push({ sql, options });
      return responder(sql, options);
    }),
    transaction: jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback(transactionHandle)),
  };
  return { sequelize, calls, transactionHandle, asSequelize: sequelize as unknown as Sequelize };
}

const plan = {
  templateCode: 'account_signup_to_login',
  templateVersion: '1.0.0',
  recipeHash: 'r'.repeat(64),
  workflowCode: 'customer_full_lifecycle',
  environmentId: 'qa-local',
  mode: 'INTEGRATED_QA',
  persons: 3,
  concurrency: 2,
  seed: 'semilla',
  datasetMode: 'NORMAL_SYNTHETIC',
  scenarioCode: 'happy_path',
  limits: { maxRequests: 100, maxDurationMs: 60_000, maxInFlightRequests: 5 },
  generatorVersion: 'persona-factory@1',
  estimatedRequests: 12,
  estimatedAdmissionMs: 0,
  stepCount: 4,
  providers: [],
} as EffectivePlan;

const admission = (overrides: Partial<AdmissionInput> = {}): AdmissionInput => ({
  tenantId: '7',
  operatorId: '11',
  idempotencyKey: 'clave-lanzamiento-1',
  planId: '5',
  planHash: 'h'.repeat(64),
  plan,
  workflowCode: 'customer_full_lifecycle',
  namespace: 'qa-abc-clave1',
  referenceDate: '2026-09-24',
  ...overrides,
});

describe('repositorio de admisión de corridas QA', () => {
  it('guarda el plan serializado y devuelve su id como texto', async () => {
    const db = fakeSequelize(() => [{ _id: 99 }]);
    const repo = new QaRunAdmissionRepository(db.asSequelize);
    const expiresAt = new Date('2026-09-24T10:15:00Z');
    const planId = await repo.savePlan({ tenantId: '7', operatorId: '11', planHash: 'h', plan, expiresAt });
    expect(planId).toBe('99');
    expect(db.calls[0].sql).toContain('INSERT INTO');
    expect(db.calls[0].options.bind).toMatchObject({ tenantId: '7', operatorId: '11', expiresAt });
    expect(JSON.parse(String(db.calls[0].options.bind?.plan))).toEqual(plan);
  });

  it('un plan de otro tenant o inexistente es null; el hash char(64) se recorta', async () => {
    const vacio = new QaRunAdmissionRepository(fakeSequelize(() => []).asSequelize);
    expect(await vacio.findPlan('5', '7')).toBeNull();

    const db = fakeSequelize(() => [
      { _id: 5, _tenant_id: 7, operator_id: '11', plan_hash: 'abc   ', plan_json: plan, expires_at: '2026-09-24T10:15:00Z' },
    ]);
    const stored = await new QaRunAdmissionRepository(db.asSequelize).findPlan('5', '7');
    expect(stored).toEqual({
      planId: '5',
      tenantId: '7',
      operatorId: '11',
      planHash: 'abc',
      plan,
      expiresAt: new Date('2026-09-24T10:15:00Z'),
    });
    expect(db.calls[0].options.bind).toEqual({ planId: '5', tenantId: '7' });
  });

  it('la misma clave con el mismo plan es una réplica idempotente: no abre transacción', async () => {
    const db = fakeSequelize(() => [{ _id: 42, plan_hash: `${'h'.repeat(64)}  `, status: 'RUNNING' }]);
    const result = await new QaRunAdmissionRepository(db.asSequelize).admit(admission());
    expect(result).toEqual({ runId: '42', status: 'RUNNING', replayed: true });
    expect(db.sequelize.transaction).not.toHaveBeenCalled();
    expect(db.calls[0].options.bind).toEqual({ tenantId: '7', operatorId: '11', idempotencyKey: 'clave-lanzamiento-1' });
  });

  it('la misma clave con OTRO plan es un conflicto, no una segunda corrida', async () => {
    const db = fakeSequelize(() => [{ _id: 42, plan_hash: 'otro', status: 'QUEUED' }]);
    const result = await new QaRunAdmissionRepository(db.asSequelize).admit(admission());
    expect(result).toEqual({ conflict: 'IDEMPOTENCY_KEY_REUSED' });
    expect(db.sequelize.transaction).not.toHaveBeenCalled();
  });

  it('corrida, personas, job y primer evento salen en UNA transacción', async () => {
    const db = fakeSequelize((sql) => {
      if (sql.includes('SELECT _id, plan_hash')) return [];
      if (sql.includes('qa_runs (_tenant_id')) return [{ _id: 42 }];
      if (sql.includes('system_job_runs')) return [{ _id: 7001 }];
      return [];
    });
    const result = await new QaRunAdmissionRepository(db.asSequelize).admit(admission());
    expect(result).toEqual({ runId: '42', status: 'QUEUED', replayed: false });

    const escrituras = db.calls.slice(1);
    expect(escrituras).toHaveLength(5);
    for (const call of escrituras) expect(call.options.transaction).toBe(db.transactionHandle);
    const [run, personas, job, enlace, evento] = escrituras;
    expect(run.options.bind).toMatchObject({ namespace: 'qa-abc-clave1', recipeHash: plan.recipeHash, seed: 'semilla' });
    expect(JSON.parse(String(run.options.bind?.counters))).toEqual({ personsRequested: 3, personsPending: 3 });
    expect(personas.sql).toContain('generate_series');
    expect(personas.options.bind).toEqual({ runId: '42', persons: 3 });
    expect(job.sql).toContain("'systems_qa_journey_run'");
    expect(JSON.parse(String(job.options.bind?.input))).toEqual({ qaRunId: '42' });
    expect(enlace.options.bind).toEqual({ jobId: 7001, runId: '42' });
    expect(evento.sql).toContain("'RUN_QUEUED'");
    expect(JSON.parse(String(evento.options.bind?.payload))).toEqual({ persons: 3, concurrency: 2 });
  });

  it('dos lanzamientos simultáneos: el perdedor relee al ganador en vez de propagar la unicidad (A29)', async () => {
    let lecturas = 0;
    const db = fakeSequelize((sql) => {
      if (sql.includes('SELECT _id, plan_hash')) return lecturas++ === 0 ? [] : [{ _id: 42, plan_hash: 'h'.repeat(64), status: 'QUEUED' }];
      return [];
    });
    db.sequelize.transaction.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { name: 'SequelizeUniqueConstraintError' }));
    const result = await new QaRunAdmissionRepository(db.asSequelize).admit(admission());
    expect(result).toEqual({ runId: '42', status: 'QUEUED', replayed: true });
    expect(lecturas).toBe(2);
  });

  it('el choque reconocido por el nombre del índice también relee; si el ganador tiene otro plan es conflicto', async () => {
    let lecturas = 0;
    const db = fakeSequelize(() => (lecturas++ === 0 ? [] : [{ _id: 42, plan_hash: 'otro', status: 'QUEUED' }]));
    db.sequelize.transaction.mockRejectedValueOnce(new Error('violates unique constraint "ux_qa_runs_idempotency"'));
    expect(await new QaRunAdmissionRepository(db.asSequelize).admit(admission())).toEqual({ conflict: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('cualquier otro error, o una unicidad sin ganador visible, se propaga', async () => {
    const otro = fakeSequelize(() => []);
    otro.sequelize.transaction.mockRejectedValueOnce(new Error('connection reset'));
    await expect(new QaRunAdmissionRepository(otro.asSequelize).admit(admission())).rejects.toThrow('connection reset');

    const sinGanador = fakeSequelize(() => []);
    sinGanador.sequelize.transaction.mockRejectedValueOnce(Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' }));
    await expect(new QaRunAdmissionRepository(sinGanador.asSequelize).admit(admission())).rejects.toThrow('dup');
  });

  it('findByIdempotencyKey devuelve la fila o null', async () => {
    const repo = new QaRunAdmissionRepository(fakeSequelize(() => []).asSequelize);
    expect(await repo.findByIdempotencyKey({ tenantId: '7', operatorId: '11', idempotencyKey: 'k' })).toBeNull();
  });

  it('cancelar una corrida QUEUED la cierra y cancela sus personas pendientes', async () => {
    const db = fakeSequelize((sql) => (sql.includes('UPDATE') && sql.includes('qa_runs') ? [{ status: 'CANCELLED' }] : []));
    const result = await new QaRunAdmissionRepository(db.asSequelize).requestCancel('7', '42');
    expect(result).toEqual({ status: 'CANCELLED' });
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0].options.bind).toEqual({ runId: '42', tenantId: '7' });
    expect(db.calls[1].sql).toContain("status = 'CANCELLED'");
    expect(db.calls[1].sql).toContain("status = 'PENDING'");
    expect(db.calls[1].options).toMatchObject({ bind: { runId: '42' }, transaction: db.transactionHandle });
  });

  it('una corrida en vuelo pasa a CANCELLING sin tocar personas; una ajena o inexistente es null', async () => {
    const enVuelo = fakeSequelize(() => [{ status: 'CANCELLING' }]);
    expect(await new QaRunAdmissionRepository(enVuelo.asSequelize).requestCancel('7', '42')).toEqual({ status: 'CANCELLING' });
    expect(enVuelo.calls).toHaveLength(1);

    const ajena = fakeSequelize(() => []);
    expect(await new QaRunAdmissionRepository(ajena.asSequelize).requestCancel('8', '42')).toBeNull();
  });
});

describe('repositorio de lecturas de corridas QA', () => {
  it('un runId no numérico no llega a la base', async () => {
    const db = fakeSequelize(() => [{ _id: 1 }]);
    const repo = new QaRunQueryRepository(db.asSequelize);
    expect(await repo.findRun('7', '1; DROP TABLE x')).toBeNull();
    expect(db.calls).toHaveLength(0);
    expect(await repo.findRun('7', '1')).toEqual({ _id: 1 });
    expect(db.calls[0].options.bind).toEqual({ runId: '1', tenantId: '7' });
  });

  it('listRuns manda null por los filtros ausentes para que el SQL los ignore', async () => {
    const db = fakeSequelize(() => []);
    const repo = new QaRunQueryRepository(db.asSequelize);
    await repo.listRuns('7', { limit: 20 });
    await repo.listRuns('7', { limit: 5, templateCode: 't', workflowCode: 'w' });
    expect(db.calls[0].options.bind).toEqual({ tenantId: '7', limit: 20, templateCode: null, workflowCode: null });
    expect(db.calls[1].options.bind).toEqual({ tenantId: '7', limit: 5, templateCode: 't', workflowCode: 'w' });
  });

  it('pagina personas con offset (página − 1) × límite y total numérico', async () => {
    const db = fakeSequelize((sql) => (sql.includes('COUNT(*)::text AS total') ? [{ total: '37' }] : [{ ordinal: 11 }]));
    const result = await new QaRunQueryRepository(db.asSequelize).listPersonas('42', { page: 3, limit: 5, status: 'FAILED' });
    expect(result).toEqual({ items: [{ ordinal: 11 }], total: 37 });
    for (const call of db.calls) expect(call.options.bind).toEqual({ runId: '42', status: 'FAILED', limit: 5, offset: 10 });

    const vacio = await new QaRunQueryRepository(fakeSequelize(() => []).asSequelize).listPersonas('42', { page: 1, limit: 5 });
    expect(vacio.total).toBe(0);
  });

  it('agregados de pasos, personas y causas raíz se piden por corrida', async () => {
    const db = fakeSequelize(() => []);
    const repo = new QaRunQueryRepository(db.asSequelize);
    await repo.stepTally('42');
    await repo.personaTally('42');
    await repo.rootCauses('42');
    await repo.listSteps('42', 'p-0001');
    await repo.events('42', 3);
    await repo.events('42', 3, 10);
    await repo.workflowEndpoints('customer_full_lifecycle');
    expect(db.calls[0].sql).toContain('GROUP BY step_key, status');
    expect(db.calls[2].sql).toContain("status IN ('FAILED', 'INDETERMINATE')");
    expect(db.calls[3].options.bind).toEqual({ runId: '42', personaKey: 'p-0001' });
    expect(db.calls[4].options.bind).toEqual({ runId: '42', after: 3, limit: 200 });
    expect(db.calls[5].options.bind).toEqual({ runId: '42', after: 3, limit: 10 });
    expect(db.calls[6].options.bind).toEqual({ workflowCode: 'customer_full_lifecycle' });
  });

  it('workers vivos, corridas activas y cola se convierten a números, con cero si no hay filas', async () => {
    const visto = new Date('2026-09-24T10:00:00Z');
    const lleno = new QaRunQueryRepository(
      fakeSequelize((sql) => {
        if (sql.includes('qa_worker_heartbeats')) return [{ count: '2', last_seen: visto }];
        if (sql.includes("status IN ('QUEUED'")) return [{ count: '1' }];
        return [{ queued: '4', running: '1', last_heartbeat: visto }];
      }).asSequelize,
    );
    expect(await lleno.liveWorkers(30)).toEqual({ count: 2, lastSeenAt: visto });
    expect(await lleno.activeRunsForTenant('7')).toBe(1);
    expect(await lleno.workerSnapshot()).toEqual({ queued: 4, running: 1, lastHeartbeatAt: visto });

    const vacio = new QaRunQueryRepository(fakeSequelize(() => []).asSequelize);
    expect(await vacio.liveWorkers(30)).toEqual({ count: 0, lastSeenAt: null });
    expect(await vacio.activeRunsForTenant('7')).toBe(0);
    expect(await vacio.workerSnapshot()).toEqual({ queued: 0, running: 0, lastHeartbeatAt: null });
  });
});

const fence = { jobRunId: '7001', fencingToken: '3' };

const step = (overrides: Partial<StepRecord> = {}): StepRecord => ({
  stepKey: 'signup.start',
  visitIndex: 0,
  logicalOperationId: 'op-1',
  status: 'PASSED',
  failures: [],
  attempts: [{ attempt: 1, status: 201, latencyMs: 5, admissionLagMs: 0 }],
  evidence: { method: 'POST', path: '/customer-onboarding/start' },
  startedAt: '',
  finishedAt: '2026-09-24T10:00:01.000Z',
  ...overrides,
});

describe('repositorio del worker QA: escrituras cercadas por fencing', () => {
  it('una escritura cercada con 0 filas devuelve false: el worker ya no es el dueño', async () => {
    const perdido = fakeSequelize(() => []);
    const repo = new QaRunWorkerRepository(perdido.asSequelize);
    expect(await repo.markRunning('42', fence)).toBe(false);
    expect(await repo.updatePersona({ personaRunId: '9', status: 'RUNNING' }, fence)).toBe(false);
    expect(await repo.upsertStep('42', '9', step(), fence)).toBe(false);
    expect(await repo.finishRun({ runId: '42', status: 'COMPLETED', verdict: 'PASSED', counters: {}, evidence: {} }, fence)).toBe(false);
    for (const call of perdido.calls) {
      expect(call.sql).toContain('j.fencing_token = $fencingToken');
      expect(call.sql).toMatch(/RETURNING 1 AS ok;$/);
      expect(call.options.bind).toMatchObject(fence);
    }
  });

  it('con una fila confirmada devuelve true', async () => {
    const repo = new QaRunWorkerRepository(fakeSequelize(() => [{ ok: 1 }]).asSequelize);
    expect(await repo.markRunning('42', fence)).toBe(true);
    expect(await repo.finishRun({ runId: '42', status: 'COMPLETED', verdict: null, counters: {}, evidence: {} }, fence)).toBe(true);
  });

  it('updatePersona manda null por los campos ausentes y banderas booleanas explícitas', async () => {
    const db = fakeSequelize(() => [{ ok: 1 }]);
    const repo = new QaRunWorkerRepository(db.asSequelize);
    await repo.updatePersona({ personaRunId: '9', status: 'RUNNING', start: true, caseCategory: 'normal' }, fence);
    await repo.updatePersona({ personaRunId: '9', status: 'FAILED', resources: { customerId: '100' }, finish: true, reason: 'x' }, fence);
    expect(db.calls[0].options.bind).toMatchObject({
      resources: null,
      failedStepKey: null,
      reason: null,
      caseCategory: 'normal',
      archetype: null,
      datasetHash: null,
      start: true,
      finish: false,
    });
    expect(db.calls[1].options.bind).toMatchObject({ resources: '{"customerId":"100"}', start: false, finish: true, reason: 'x' });
  });

  it('upsertStep serializa fallos, intentos y evidencia; un inicio vacío va como null', async () => {
    const db = fakeSequelize(() => [{ ok: 1 }]);
    await new QaRunWorkerRepository(db.asSequelize).upsertStep('42', '9', step({ workflowStepCode: 'lifecycle.signup' }), fence);
    const bind = db.calls[0].options.bind!;
    expect(bind).toMatchObject({
      personaRunId: '9',
      runId: '42',
      workflowStepCode: 'lifecycle.signup',
      branch: null,
      reason: null,
      rootCause: null,
      startedAt: null,
      finishedAt: '2026-09-24T10:00:01.000Z',
    });
    expect(JSON.parse(String(bind.attempts))).toEqual(step().attempts);
    expect(db.calls[0].sql).toContain('ON CONFLICT (persona_run_id, step_key, visit_index)');
  });

  it('los checkpoints reparten los pasos a SU persona y normalizan nulos y fechas', async () => {
    const db = fakeSequelize((sql) =>
      sql.includes('qa_persona_runs')
        ? [
            { _id: 9, ordinal: '1', persona_key: 'p-0001', status: 'RUNNING', resources_json: null },
            { _id: 10, ordinal: '2', persona_key: 'p-0002', status: 'PENDING', resources_json: { customerId: '5' } },
          ]
        : [
            {
              persona_run_id: 9,
              step_key: 'signup.start',
              workflow_step_code: null,
              visit_index: '0',
              logical_operation_id: 'op-1   ',
              status: 'PASSED',
              branch: null,
              reason: null,
              root_cause_step_key: null,
              failures_json: null,
              attempts_json: null,
              evidence_json: null,
              started_at: '2026-09-24T10:00:00Z',
              finished_at: null,
            },
          ],
    );
    const [primera, segunda] = await new QaRunWorkerRepository(db.asSequelize).loadCheckpoints('42');
    expect(primera).toMatchObject({ personaRunId: '9', ordinal: 1, personaKey: 'p-0001', resources: {} });
    expect(primera.steps).toEqual([
      {
        stepKey: 'signup.start',
        workflowStepCode: undefined,
        visitIndex: 0,
        logicalOperationId: 'op-1',
        status: 'PASSED',
        branch: undefined,
        reason: undefined,
        rootCauseStepKey: undefined,
        failures: [],
        attempts: [],
        evidence: {},
        startedAt: '2026-09-24T10:00:00.000Z',
        finishedAt: '',
      },
    ]);
    expect(segunda).toMatchObject({ personaRunId: '10', resources: { customerId: '5' }, steps: [] });
  });

  it('el evento se numera bajo el bloqueo de la fila de la corrida', async () => {
    const db = fakeSequelize(() => []);
    await new QaRunWorkerRepository(db.asSequelize).appendEvent('42', 'PERSONA_FINISHED', { personaKey: 'p-0001' });
    expect(db.sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(db.calls[0].sql).toContain('FOR UPDATE');
    expect(db.calls[1].sql).toContain('COALESCE(MAX(sequence), 0) + 1');
    expect(db.calls[1].options).toMatchObject({
      bind: { runId: '42', type: 'PERSONA_FINISHED', payload: '{"personaKey":"p-0001"}' },
      transaction: db.transactionHandle,
    });
  });

  it('lecturas y escrituras sin fencing de la corrida', async () => {
    const db = fakeSequelize((sql) => {
      if (sql.includes('cancel_requested_at AS c')) return [{ c: new Date() }];
      if (sql.includes('requests_issued AS n')) return [{ n: '17' }];
      if (sql.includes('SELECT _id, _tenant_id')) return [{ _id: 42, status: 'QUEUED' }];
      return [];
    });
    const repo = new QaRunWorkerRepository(db.asSequelize);
    expect(await repo.loadRun('42')).toEqual({ _id: 42, status: 'QUEUED' });
    expect(await repo.isCancelRequested('42')).toBe(true);
    expect(await repo.requestsIssued('42')).toBe(17);
    await repo.addRequests('42', 3);
    await repo.saveProgress('42', { personsPassed: 1 });
    await repo.mergeResources('9', { customerId: '100' }, fence);
    await repo.closePendingPersonas('42', 'CANCELLED', 'corrida cancelada', fence);
    await repo.recordResource('42', { personaKey: 'p-0001', service: 'backend', resourceType: 'customer', resourceId: '100' });
    const binds = db.calls.slice(3).map((call) => call.options.bind);
    expect(binds).toEqual([
      { runId: '42', count: 3 },
      { runId: '42', counters: '{"personsPassed":1}' },
      { personaRunId: '9', resources: '{"customerId":"100"}', ...fence },
      { runId: '42', status: 'CANCELLED', reason: 'corrida cancelada', ...fence },
      { runId: '42', personaKey: 'p-0001', service: 'backend', resourceType: 'customer', resourceId: '100' },
    ]);
    expect(db.calls[6].sql).toContain("status IN ('PENDING','RUNNING')");

    const vacio = new QaRunWorkerRepository(fakeSequelize(() => []).asSequelize);
    expect(await vacio.loadRun('42')).toBeNull();
    expect(await vacio.isCancelRequested('42')).toBe(false);
    expect(await vacio.requestsIssued('42')).toBe(0);
  });
});

describe('repositorio de soporte: secreto, latido y producto', () => {
  it('guarda, lee y purga el secreto del mock por corrida', async () => {
    const expiresAt = new Date('2026-09-24T12:00:00Z');
    const db = fakeSequelize((sql) => (sql.startsWith('SELECT') ? [{ mock_run_token_encrypted: 'v1:x', mock_epoch: 'e1' }] : []));
    const repo = new QaRunSupportRepository(db.asSequelize);
    await repo.saveSecret('42', 'v1:x', 'e1', expiresAt);
    expect(await repo.readSecret('42')).toEqual({ token: 'v1:x', epoch: 'e1' });
    await repo.purgeSecret('42');
    expect(db.calls[0].sql).toContain('ON CONFLICT (run_id) DO UPDATE');
    expect(db.calls[0].options.bind).toEqual({ runId: '42', token: 'v1:x', epoch: 'e1', expiresAt });
    expect(db.calls[1].sql).toContain('expires_at > now()');
    expect(db.calls[2].sql).toContain('DELETE FROM');

    expect(await new QaRunSupportRepository(fakeSequelize(() => []).asSequelize).readSecret('42')).toBeNull();
  });

  it('el latido hace upsert por worker con su versión', async () => {
    const db = fakeSequelize(() => []);
    await new QaRunSupportRepository(db.asSequelize).workerHeartbeat('host:1:abc', 'dev');
    expect(db.calls[0].options.bind).toEqual({ workerId: 'host:1:abc', version: 'dev' });
    expect(db.calls[0].sql).toContain('ON CONFLICT (worker_id)');
  });

  it('el producto activo se resuelve por consulta con montos numéricos, o null', async () => {
    const db = fakeSequelize(() => [{ _id: 3, min_amount: '500.00', max_amount: '20000.00' }]);
    expect(await new QaRunSupportRepository(db.asSequelize).findActiveCreditProduct('7')).toEqual({
      id: '3',
      minAmount: 500,
      maxAmount: 20_000,
    });
    expect(db.calls[0].sql).toContain("status = 'active'");
    expect(db.calls[0].options.bind).toEqual({ tenantId: '7' });
    expect(await new QaRunSupportRepository(fakeSequelize(() => []).asSequelize).findActiveCreditProduct('7')).toBeNull();
  });
});
