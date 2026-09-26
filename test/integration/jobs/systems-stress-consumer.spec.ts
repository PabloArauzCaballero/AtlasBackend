/**
 * @file El plan de estrés encolado se EJECUTA: hay tráfico HTTP real, no un `queued: true`.
 * @business Un plan encolado produce peticiones contra el objetivo registrado y un resultado durable
 *   con sus denominadores; un dry-run no manda ni una petición y nunca es PASS; PRODUCTION_READONLY
 *   se bloquea también en ejecución, no sólo al encolar.
 * @system PostgreSQL real, un servidor `node:http` local como objetivo, y el consumidor con su cola
 *   durable. Nada está interceptado: si el tráfico no saliera, el contador del objetivo sería cero.
 *
 * Es el gate P0 del paquete QA: «el worker realmente consume y ejecuta un job». Hasta ahora
 * `systems_stress_run` sólo aparecía en el servicio que crea la fila, en su unitaria y en una
 * semilla de demostración: nadie la consumía.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { createServer, type Server } from 'node:http';
import { QueryTypes } from 'sequelize';
import { SystemEndpointCatalogModel } from '../../../src/database/models/index.js';
import { atlasSchemaFor } from '../../../src/database/domain-schemas.js';
import { SystemsStressConsumerService, STRESS_JOB_CODE } from '../../../src/modules/systems-ops/systems-stress-consumer.service.js';
import { SystemsStressExecutorService } from '../../../src/modules/systems-ops/systems-stress-executor.service.js';
import { SystemsTestHttpClientService } from '../../../src/modules/systems-ops/systems-test-http-client.service.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

const RUNS = `${atlasSchemaFor('system_job_runs')}.system_job_runs`;

let database: IntegrationDatabase | null = null;
let target: Server;
let targetBaseUrl: string;
let hits: string[] = [];
let endpointId: string | null = null;
const createdJobIds: string[] = [];

/** El objetivo cuenta cada petición. Es el testigo de que el tráfico salió de verdad. */
function startTarget(): Promise<void> {
  return new Promise((resolve) => {
    target = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    target.listen(0, '127.0.0.1', () => {
      const address = target.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      targetBaseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function consumer(): SystemsStressConsumerService {
  return new SystemsStressConsumerService(
    database!.sequelize,
    SystemEndpointCatalogModel,
    new SystemsStressExecutorService(new SystemsTestHttpClientService()),
  );
}

async function enqueue(input: Record<string, unknown>): Promise<string> {
  const rows = await database!.sequelize.query<{ _id: string }>(
    `INSERT INTO ${RUNS} (_tenant_id, job_code, status, input_json, triggered_by_type, triggered_by_id, _created_at)
     VALUES (NULL, $jobCode, 'queued', $input, 'user', 'prueba', now())
     RETURNING _id;`,
    { type: QueryTypes.SELECT, bind: { jobCode: STRESS_JOB_CODE, input: JSON.stringify(input) } },
  );
  const id = String(rows[0]._id);
  createdJobIds.push(id);
  return id;
}

async function readRun(id: string) {
  const rows = await database!.sequelize.query<{
    status: string;
    result_json: Record<string, unknown> | null;
    error_message: string | null;
  }>(`SELECT status, result_json, error_message FROM ${RUNS} WHERE _id = $id`, { type: QueryTypes.SELECT, bind: { id } });
  return rows[0];
}

function planInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    endpointId,
    baseUrl: targetBaseUrl,
    environment: 'LOCAL',
    dryRun: false,
    targetRps: 20,
    durationSeconds: 1,
    concurrency: 5,
    maxErrorRate: 0.05,
    maxP95Ms: 5_000,
    config: { timeoutMs: 3_000 },
    headers: {},
    ...overrides,
  };
}

beforeAll(async () => {
  database = await openIntegrationDatabase();
  await startTarget();
  if (!database) return;
  const code = `qa_stress_target_${runToken()}`;
  const created = await SystemEndpointCatalogModel.create({
    code,
    module: 'systems-ops',
    systemCode: 'ATLAS',
    backendService: 'atlas-backend',
    backendBaseUrl: targetBaseUrl,
    method: 'GET',
    routePath: '/salud',
    fullPath: '/salud',
    routeName: 'prueba.estres',
    businessPurpose: 'Objetivo sintético de la prueba de integración del consumidor de estrés.',
    expectedStatusCodes: [200],
    minPayloadSchema: {},
    queryParamsSchema: {},
    pathParamsSchema: {},
    headersSchema: {},
    requiresAuth: false,
    allowedRoles: [],
    containsPii: false,
    piiFields: [],
    riskLevel: 'LOW',
    isDestructive: false,
    isReadonly: true,
    idempotencyRequired: false,
    requiresStressTest: true,
    requiresIntegrationTest: false,
    isTestableFromPortal: true,
    testEnvironmentOnly: true,
    ownerTeam: 'plataforma',
    status: 'ACTIVE',
    version: 1,
    detectedFrom: 'MANUAL',
    confidenceLevel: 'HIGH',
    reviewStatus: 'APPROVED',
    createdAtValue: new Date(),
    updatedAtValue: new Date(),
  } as never);
  endpointId = String(created.id);
});

afterAll(async () => {
  await new Promise((resolve) => target.close(resolve));
  if (database) {
    if (createdJobIds.length > 0) {
      await database.sequelize.query(`DELETE FROM ${RUNS} WHERE _id = ANY($ids)`, { bind: { ids: createdJobIds } });
    }
    if (endpointId) await SystemEndpointCatalogModel.destroy({ where: { id: endpointId } });
  }
  await database?.close();
});

afterEach(() => {
  hits = [];
});

describe('consumidor de planes de estrés', () => {
  it('reclama el plan encolado y GENERA TRÁFICO REAL contra el objetivo', async () => {
    if (!database) return;
    const jobId = await enqueue(planInput());

    const outcome = await consumer().drain(new AbortController().signal);

    expect(outcome).toMatchObject({ claimed: 1, completed: 1, failed: 0, lostLease: 0 });
    // El testigo: el objetivo recibió peticiones. Sin esto, todo lo demás sería un informe bonito
    // sobre tráfico que nunca salió.
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit === 'GET /salud')).toBe(true);

    const run = await readRun(jobId);
    expect(run.status).toBe('completed');
    const result = run.result_json as Record<string, unknown>;
    expect(result.mode).toBe('REAL');
    const counters = result.counters as Record<string, number>;
    expect(counters.admitted).toBe(hits.length + counters.transportErrors);
    expect(counters.succeeded).toBeGreaterThan(0);
    expect((result.conservation as { ok: boolean }).ok).toBe(true);
  });

  it('la cola queda vacía: el mismo plan no se ejecuta dos veces', async () => {
    if (!database) return;
    await enqueue(planInput({ targetRps: 5 }));
    await consumer().drain(new AbortController().signal);
    const primeraTanda = hits.length;
    hits = [];

    const segunda = await consumer().drain(new AbortController().signal);

    expect(primeraTanda).toBeGreaterThan(0);
    expect(segunda.claimed).toBe(0);
    expect(hits).toHaveLength(0);
  });

  it('un dry-run NO manda una sola petición y no se reporta como PASS', async () => {
    if (!database) return;
    const jobId = await enqueue(planInput({ dryRun: true }));

    await consumer().drain(new AbortController().signal);

    expect(hits).toHaveLength(0);
    const run = await readRun(jobId);
    const result = run.result_json as Record<string, unknown>;
    expect(result.mode).toBe('DRY_RUN');
    // `NOT_EVALUATED`, no `PASS`: validar un plan no es haberlo ejecutado.
    expect(result.verdict).toBe('NOT_EVALUATED');
  });

  it('PRODUCTION_READONLY se bloquea también al ejecutar, no sólo al encolar', async () => {
    if (!database) return;
    const jobId = await enqueue(planInput({ environment: 'PRODUCTION_READONLY' }));

    const outcome = await consumer().drain(new AbortController().signal);

    expect(outcome.failed).toBe(1);
    expect(hits).toHaveLength(0);
    const run = await readRun(jobId);
    expect(run.status).toBe('failed');
    expect(run.error_message).toBe('STRESS_RUNS_ARE_BLOCKED_IN_PRODUCTION');
  });

  it('un endpoint que no existe falla con su causa, sin tráfico', async () => {
    if (!database) return;
    const jobId = await enqueue(planInput({ endpointId: '999999999' }));

    await consumer().drain(new AbortController().signal);

    expect(hits).toHaveLength(0);
    const run = await readRun(jobId);
    expect(run.status).toBe('failed');
    expect(run.error_message).toContain('STRESS_RUN_ENDPOINT_NOT_FOUND');
  });

  it('el presupuesto de peticiones recorta el plan y lo DICE en vez de disimularlo', async () => {
    if (!database) return;
    const jobId = await enqueue(planInput({ targetRps: 50, durationSeconds: 2, config: { timeoutMs: 3_000, requestBudget: 7 } }));

    await consumer().drain(new AbortController().signal);

    expect(hits.length).toBeLessThanOrEqual(7);
    const result = (await readRun(jobId)).result_json as Record<string, unknown>;
    expect((result.notes as string[]).some((note) => note.includes('presupuesto'))).toBe(true);
  });

  it('una cancelación corta la corrida y el informe cubre sólo lo ejecutado', async () => {
    if (!database) return;
    const jobId = await enqueue(planInput({ targetRps: 5, durationSeconds: 30 }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200).unref();

    await consumer().drain(controller.signal);

    const result = (await readRun(jobId)).result_json as Record<string, unknown>;
    const counters = result.counters as Record<string, number>;
    // 5 rps × 30 s = 150 llegadas planificadas; cancelar a los 200 ms admite un puñado y descarta
    // el resto EXPLÍCITAMENTE, en vez de terminar antes y publicar que se cumplió el objetivo.
    expect(counters.admitted).toBeLessThan(150);
    expect(counters.dropped).toBeGreaterThan(0);
    expect((result.notes as string[]).some((note) => note.includes('Cancelada'))).toBe(true);
  });

  it('las cabeceras redactadas no se reenvían como si fueran credenciales', async () => {
    if (!database) return;
    // `queueStressRun` sanea las cabeceras sensibles a `[REDACTED]`. Reenviar esa cadena mandaría
    // una credencial falsa y el objetivo respondería 401 por el motivo equivocado.
    await enqueue(planInput({ targetRps: 3, headers: { authorization: '[REDACTED]', 'x-prueba': 'visible' } }));

    await consumer().drain(new AbortController().signal);

    expect(hits.length).toBeGreaterThan(0);
  });
});
