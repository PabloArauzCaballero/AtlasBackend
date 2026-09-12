/**
 * @file AT-038 — leases de trabajos singleton con PostgreSQL real, deadlines y aislamiento entre jobs.
 * @business Dos workers reclaman el mismo job singleton: uno ejecuta; un handler lento vence su deadline
 *   sin bloquear otros jobs; el registro rechaza duplicados y deadlines mayores que el intervalo.
 * @system `acquireJobLease` con `pg_try_advisory_xact_lock` sobre dos conexiones distintas.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../../../src/config/database.config.js';
import type { JobHandler } from '../../../src/platform/jobs/job-handler.port.js';
import { JobRegistry, acquireJobLease, runWithLease } from '../../../src/platform/jobs/job-registry.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let second: Sequelize | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) {
    second = new Sequelize({ ...buildSequelizeOptions(), models: [], logging: false });
    await second.authenticate();
  }
});
afterAll(async () => {
  await second?.close();
  await database?.close();
});

const handler = (jobCode: string, run: JobHandler['run'], deadlineMs = 1000): JobHandler => ({
  descriptor: { jobCode, version: 1, intervalMs: 60_000, concurrency: 'singleton', deadlineMs },
  run,
});

describe('AT-038 · registro y leases de trabajos', () => {
  it('el registro rechaza códigos duplicados, versiones inválidas y deadlines mayores que el intervalo', () => {
    const ok = handler('process_events', async () => ({}));
    expect(() => new JobRegistry([ok, ok])).toThrow('JOB_CODE_DUPLICATED');
    expect(() => new JobRegistry([{ ...ok, descriptor: { ...ok.descriptor, version: 0 } }])).toThrow('JOB_VERSION_INVALID');
    expect(() => new JobRegistry([{ ...ok, descriptor: { ...ok.descriptor, deadlineMs: 120_000 } }])).toThrow(
      'JOB_DEADLINE_EXCEEDS_INTERVAL',
    );
    expect(new JobRegistry([ok]).descriptors()).toHaveLength(1);
  });

  it('dos workers reclaman el mismo job singleton: uno ejecuta, el otro se salta; tras liberar, el segundo puede', async () => {
    if (!database || !second) return;
    const jobCode = `job_${runToken()}`;
    const lease = await acquireJobLease(database.sequelize, jobCode);
    expect(lease).not.toBeNull();
    expect(await acquireJobLease(second, jobCode)).toBeNull();
    const outcome = await runWithLease(
      second,
      handler(jobCode, async () => ({ ran: true })),
      '1',
    );
    expect(outcome.outcome).toBe('skipped');
    await lease!.release();
    expect(
      (
        await runWithLease(
          second,
          handler(jobCode, async () => ({ ran: true })),
          '1',
        )
      ).outcome,
    ).toBe('ran');
  });

  it('un handler lento vence su deadline y libera el lease; otro job no se ve afectado', async () => {
    if (!database || !second) return;
    const slow = handler(`slow_${runToken()}`, () => new Promise((resolve) => setTimeout(() => resolve({}), 500)), 50);
    const fast = handler(`fast_${runToken()}`, async () => ({ fast: true }));
    const [slowOutcome, fastOutcome] = await Promise.all([runWithLease(database.sequelize, slow, '1'), runWithLease(second, fast, '1')]);
    expect(slowOutcome.outcome).toBe('timed_out');
    expect(fastOutcome.outcome).toBe('ran');
    const freed = await acquireJobLease(second, slow.descriptor.jobCode); // el lease se liberó al vencer
    expect(freed).not.toBeNull();
    await freed!.release();
  });

  it('el lease se libera al cerrar la conexión (muerte del proceso): otro worker puede reclamar', async () => {
    if (!database) return;
    const dying = new Sequelize({ ...buildSequelizeOptions(), models: [], logging: false });
    const jobCode = `dying_${runToken()}`;
    const held = await acquireJobLease(dying, jobCode);
    expect(held).not.toBeNull();
    // «Muerte» del proceso: PostgreSQL cierra su sesión y con ella el bloqueo consultivo.
    await database.sequelize.query('SELECT pg_terminate_backend($pid)', { bind: { pid: held!.sessionPid } });
    const lease = await acquireJobLease(database.sequelize, jobCode);
    expect(lease).not.toBeNull();
    await lease!.release();
    // El pool de la sesión «muerta» no puede quedar abierto: mantendría vivo a jest. Cierre acotado.
    await Promise.race([dying.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 2000))]);
  });
});
