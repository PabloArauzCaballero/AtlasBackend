/**
 * @file Consumo durable de `system_job_runs` con PostgreSQL real: claim, lease, fencing y recuperación.
 * @business Un plan encolado se reclama UNA sola vez aunque compitan dos workers; si el worker muere,
 *   otro lo retoma cuando vence el lease; y el worker muerto que revive NO puede confirmar encima del
 *   nuevo. Un trabajo que revienta siempre deja de reclamarse en vez de llevarse el worker por delante.
 * @system `DurableJobQueue` contra la tabla real. Dos conexiones distintas para que la carrera sea de
 *   verdad y no una secuencia dentro de la misma sesión.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../../../src/config/database.config.js';
import { DurableJobQueue } from '../../../src/platform/jobs/durable-job-queue.js';
import { atlasSchemaFor } from '../../../src/database/domain-schemas.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

const SCHEMA = atlasSchemaFor('system_job_runs');
const TABLE = `${SCHEMA}.system_job_runs`;

let database: IntegrationDatabase | null = null;
let second: Sequelize | null = null;
const jobCodes: string[] = [];

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) {
    // Segunda conexión = segundo "worker". Con una sola sesión, `SKIP LOCKED` no tiene nada que
    // saltarse y la carrera que se quiere medir no llega a ocurrir.
    second = new Sequelize({ ...buildSequelizeOptions(), models: [], logging: false });
    await second.authenticate();
  }
});

afterAll(async () => {
  await second?.close();
  await database?.close();
});

afterEach(async () => {
  if (!database || jobCodes.length === 0) return;
  await database.sequelize.query(`DELETE FROM ${TABLE} WHERE job_code = ANY($codes)`, { bind: { codes: jobCodes } });
  jobCodes.length = 0;
});

function queue(sequelize: Sequelize, overrides: { leaseMs?: number; maxAttempts?: number } = {}): DurableJobQueue {
  return new DurableJobQueue(sequelize, { schema: SCHEMA, leaseMs: overrides.leaseMs ?? 30_000, maxAttempts: overrides.maxAttempts ?? 3 });
}

async function enqueue(jobCode: string, input: Record<string, unknown> = {}, createdAt = new Date()): Promise<string> {
  const rows = await database!.sequelize.query<{ _id: string }>(
    `INSERT INTO ${TABLE} (_tenant_id, job_code, status, input_json, triggered_by_type, triggered_by_id, _created_at)
     VALUES (NULL, $jobCode, 'queued', $input, 'user', 'prueba', $createdAt)
     RETURNING _id;`,
    { type: QueryTypes.SELECT, bind: { jobCode, input: JSON.stringify(input), createdAt } },
  );
  return String(rows[0]._id);
}

function uniqueCode(): string {
  const code = `qa_run_${runToken()}`;
  jobCodes.push(code);
  return code;
}

async function readRow(id: string) {
  const rows = await database!.sequelize.query<{
    status: string;
    claimed_by: string | null;
    attempts: number;
    fencing_token: string | null;
    result_json: Record<string, unknown> | null;
    error_message: string | null;
  }>(`SELECT status, claimed_by, attempts, fencing_token, result_json, error_message FROM ${TABLE} WHERE _id = $id`, {
    type: QueryTypes.SELECT,
    bind: { id },
  });
  return rows[0];
}

describe('cola durable de system_job_runs', () => {
  it('un trabajo encolado se reclama y queda en ejecución con dueño y lease', async () => {
    if (!database) return;
    const jobCode = uniqueCode();
    const id = await enqueue(jobCode, { profileCode: 'smoke' });

    const claimed = await queue(database.sequelize).claim([jobCode], 'worker-a');

    expect(claimed).not.toBeNull();
    expect(claimed!.jobRunId).toBe(id);
    expect(claimed!.inputJson).toEqual({ profileCode: 'smoke' });
    expect(claimed!.attempt).toBe(1);
    expect(claimed!.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());

    const row = await readRow(id);
    expect(row.status).toBe('running');
    expect(row.claimed_by).toBe('worker-a');
  });

  it('sin trabajo disponible devuelve null, no espera', async () => {
    if (!database) return;
    expect(await queue(database.sequelize).claim([uniqueCode()], 'worker-a')).toBeNull();
  });

  it('dos workers compitiendo por un trabajo: uno lo toma y el otro se va con las manos vacías', async () => {
    if (!database || !second) return;
    const jobCode = uniqueCode();
    await enqueue(jobCode);

    const [a, b] = await Promise.all([queue(database.sequelize).claim([jobCode], 'worker-a'), queue(second).claim([jobCode], 'worker-b')]);

    const ganadores = [a, b].filter((claim) => claim !== null);
    expect(ganadores).toHaveLength(1);
  });

  it('dos trabajos y dos workers: se reparten en vez de hacer cola', async () => {
    if (!database || !second) return;
    const jobCode = uniqueCode();
    await enqueue(jobCode, { n: 1 }, new Date(Date.now() - 2_000));
    await enqueue(jobCode, { n: 2 }, new Date(Date.now() - 1_000));

    const [a, b] = await Promise.all([queue(database.sequelize).claim([jobCode], 'worker-a'), queue(second).claim([jobCode], 'worker-b')]);

    // Es el sentido de SKIP LOCKED: con `FOR UPDATE` a secas, el segundo esperaría al primero y el
    // paralelismo desaparecería justo cuando hace falta.
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.jobRunId).not.toBe(b!.jobRunId);
  });

  it('la cola es justa: se reclama la fila más antigua primero', async () => {
    if (!database) return;
    const jobCode = uniqueCode();
    const viejo = await enqueue(jobCode, { n: 1 }, new Date(Date.now() - 60_000));
    await enqueue(jobCode, { n: 2 }, new Date());

    const claimed = await queue(database.sequelize).claim([jobCode], 'worker-a');
    expect(claimed!.jobRunId).toBe(viejo);
  });

  it('un trabajo en ejecución con lease vigente NO se le quita a su dueño', async () => {
    if (!database || !second) return;
    const jobCode = uniqueCode();
    await enqueue(jobCode);
    await queue(database.sequelize).claim([jobCode], 'worker-a');

    expect(await queue(second).claim([jobCode], 'worker-b')).toBeNull();
  });

  it('si el worker muere, el lease vence y otro lo retoma', async () => {
    if (!database || !second) return;
    const jobCode = uniqueCode();
    const id = await enqueue(jobCode);
    // Lease de 1 ms: el equivalente a "el worker murió hace rato", sin esperar de verdad.
    const muerto = await queue(database.sequelize, { leaseMs: 1 }).claim([jobCode], 'worker-muerto');
    expect(muerto).not.toBeNull();

    const rescate = await queue(second).claim([jobCode], 'worker-vivo', new Date(Date.now() + 1_000));

    expect(rescate).not.toBeNull();
    expect(rescate!.jobRunId).toBe(id);
    expect(rescate!.attempt).toBe(2);
    // Token distinto: eso es lo que después impide que el viejo confirme.
    expect(rescate!.fencingToken).not.toBe(muerto!.fencingToken);
  });

  it('FENCING: el worker que perdió el lease no puede confirmar encima del nuevo', async () => {
    if (!database || !second) return;
    const jobCode = uniqueCode();
    const id = await enqueue(jobCode);
    const viejo = await queue(database.sequelize, { leaseMs: 1 }).claim([jobCode], 'worker-viejo');
    const nuevo = await queue(second).claim([jobCode], 'worker-nuevo', new Date(Date.now() + 1_000));
    expect(nuevo).not.toBeNull();

    // El viejo "revive" —estuvo pausado por GC, por swap, por una pausa de la VM— y cree que sigue
    // siendo el dueño. Su confirmación tiene que no tocar ninguna fila, no pisar la del nuevo.
    const confirmoElViejo = await queue(database.sequelize).complete(viejo!, { status: 'completed', resultJson: { de: 'el viejo' } });
    expect(confirmoElViejo).toBe(false);

    const confirmoElNuevo = await queue(second).complete(nuevo!, { status: 'completed', resultJson: { de: 'el nuevo' } });
    expect(confirmoElNuevo).toBe(true);

    const row = await readRow(id);
    expect(row.status).toBe('completed');
    expect(row.result_json).toEqual({ de: 'el nuevo' });
  });

  it('el heartbeat del worker que perdió el lease devuelve false: tiene que abandonar, no terminar', async () => {
    if (!database || !second) return;
    const jobCode = uniqueCode();
    await enqueue(jobCode);
    const viejo = await queue(database.sequelize, { leaseMs: 1 }).claim([jobCode], 'worker-viejo');
    await queue(second).claim([jobCode], 'worker-nuevo', new Date(Date.now() + 1_000));

    expect(await queue(database.sequelize).heartbeat(viejo!)).toBe(false);
  });

  it('el heartbeat del dueño renueva el lease y lo mantiene fuera del alcance de otro', async () => {
    if (!database || !second) return;
    const jobCode = uniqueCode();
    await enqueue(jobCode);
    const dueño = await queue(database.sequelize, { leaseMs: 50 }).claim([jobCode], 'worker-a');

    const renovado = await queue(database.sequelize, { leaseMs: 60_000 }).heartbeat(dueño!);
    expect(renovado).toBe(true);

    // Aunque el lease ORIGINAL ya habría vencido, el renovado no: nadie más puede tomarlo.
    expect(await queue(second).claim([jobCode], 'worker-b', new Date(Date.now() + 1_000))).toBeNull();
  });

  it('un fallo se persiste con su motivo y no se reclama como si nada hubiera pasado', async () => {
    if (!database) return;
    const jobCode = uniqueCode();
    const id = await enqueue(jobCode);
    const claimed = await queue(database.sequelize).claim([jobCode], 'worker-a');

    await queue(database.sequelize).complete(claimed!, { status: 'failed', errorMessage: 'TARGET_UNREACHABLE' });

    const row = await readRow(id);
    expect(row.status).toBe('failed');
    expect(row.error_message).toBe('TARGET_UNREACHABLE');
    expect(await queue(database.sequelize).claim([jobCode], 'worker-a')).toBeNull();
  });

  it('un trabajo que revienta siempre deja de reclamarse al agotar sus intentos', async () => {
    if (!database) return;
    const jobCode = uniqueCode();
    await enqueue(jobCode);
    const cola = queue(database.sequelize, { leaseMs: 1, maxAttempts: 2 });
    const futuro = (segundos: number) => new Date(Date.now() + segundos * 1_000);

    expect(await cola.claim([jobCode], 'w', futuro(1))).not.toBeNull();
    expect(await cola.claim([jobCode], 'w', futuro(2))).not.toBeNull();
    // Tercera vuelta: ya agotó los dos intentos. Sin este tope, un trabajo roto se lleva el worker
    // por delante en un bucle infinito.
    expect(await cola.claim([jobCode], 'w', futuro(3))).toBeNull();
  });

  it('los trabajos abandonados se pueden enumerar: uno que nadie ejecuta y nadie reporta es peor que uno fallido', async () => {
    if (!database) return;
    const jobCode = uniqueCode();
    const id = await enqueue(jobCode);
    const cola = queue(database.sequelize, { leaseMs: 1, maxAttempts: 1 });
    await cola.claim([jobCode], 'worker-muerto');

    const abandonados = await cola.listAbandoned([jobCode], new Date(Date.now() + 1_000));
    expect(abandonados).toEqual([{ jobRunId: id, attempts: 1 }]);
  });

  it('release devuelve el trabajo a la cola: un apagado ordenado no obliga a esperar el lease', async () => {
    if (!database || !second) return;
    const jobCode = uniqueCode();
    await enqueue(jobCode);
    const claimed = await queue(database.sequelize).claim([jobCode], 'worker-a');

    expect(await queue(database.sequelize).release(claimed!)).toBe(true);
    const retomado = await queue(second).claim([jobCode], 'worker-b');
    expect(retomado).not.toBeNull();
    expect(retomado!.attempt).toBe(2);
  });

  it('un worker que perdió el lease tampoco puede devolver el trabajo a la cola', async () => {
    if (!database || !second) return;
    const jobCode = uniqueCode();
    await enqueue(jobCode);
    const viejo = await queue(database.sequelize, { leaseMs: 1 }).claim([jobCode], 'worker-viejo');
    await queue(second).claim([jobCode], 'worker-nuevo', new Date(Date.now() + 1_000));

    expect(await queue(database.sequelize).release(viejo!)).toBe(false);
  });

  it('la profundidad separa lo listo, lo en vuelo y lo vencido', async () => {
    if (!database) return;
    const jobCode = uniqueCode();
    await enqueue(jobCode, { n: 1 });
    await enqueue(jobCode, { n: 2 });
    await enqueue(jobCode, { n: 3 });

    const cola = queue(database.sequelize, { leaseMs: 60_000 });
    await cola.claim([jobCode], 'worker-a');

    const profundidad = await cola.depth([jobCode]);
    expect(profundidad).toEqual({ queued: 2, running: 1, expired: 0 });

    // Lo vencido NO se cuenta como en vuelo: es trabajo que nadie está haciendo.
    const masTarde = await cola.depth([jobCode], new Date(Date.now() + 120_000));
    expect(masTarde).toEqual({ queued: 2, running: 0, expired: 1 });
  });

  it('un jobCode ajeno no se reclama: la cola está particionada por código', async () => {
    if (!database) return;
    const mio = uniqueCode();
    const ajeno = uniqueCode();
    await enqueue(ajeno);

    expect(await queue(database.sequelize).claim([mio], 'worker-a')).toBeNull();
  });
});
