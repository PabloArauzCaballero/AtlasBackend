/**
 * @file Registro de trabajos y lease por trabajo (AT-038).
 * @business Dos workers que reclaman el mismo job singleton: uno ejecuta; un apagado durante la tanda
 *   libera el lease o deja que venza, sin doble confirmación; un manejador lento no bloquea a los demás.
 * @system Registro inmutable con validación de duplicados/versiones; lease por bloqueo consultivo de
 *   PostgreSQL (`pg_try_advisory_lock`) sobre una conexión dedicada, que se libera al terminar o al
 *   cerrar la conexión (muerte del proceso). No usa Redis: el lease vive donde viven los datos.
 */
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import type { JobDescriptor, JobHandler } from './job-handler.port.js';

export class JobRegistry {
  private readonly byCode = new Map<string, JobHandler>();

  constructor(handlers: readonly JobHandler[]) {
    for (const handler of handlers) {
      const { jobCode, version, intervalMs, deadlineMs } = handler.descriptor;
      if (!/^[a-z][a-z0-9_]{2,79}$/.test(jobCode)) throw new Error(`JOB_CODE_INVALID: ${jobCode}`);
      if (this.byCode.has(jobCode)) throw new Error(`JOB_CODE_DUPLICATED: ${jobCode}`);
      if (!Number.isInteger(version) || version < 1) throw new Error(`JOB_VERSION_INVALID: ${jobCode}`);
      if (deadlineMs > intervalMs) throw new Error(`JOB_DEADLINE_EXCEEDS_INTERVAL: ${jobCode}`);
      this.byCode.set(jobCode, handler);
    }
  }

  descriptors(): JobDescriptor[] {
    return [...this.byCode.values()].map((handler) => handler.descriptor);
  }

  get(jobCode: string): JobHandler | null {
    return this.byCode.get(jobCode) ?? null;
  }
}

export type JobLease = Readonly<{
  jobCode: string;
  /** Sesión de PostgreSQL que sostiene el bloqueo; si muere, el bloqueo se libera. */
  sessionPid: number;
  release: () => Promise<void>;
}>;

/**
 * Lease singleton por job: `pg_try_advisory_lock(hashtext(jobCode))` en una transacción abierta que
 * se mantiene hasta `release`. Si el proceso muere, PostgreSQL libera el bloqueo al cerrar la sesión.
 */
export async function acquireJobLease(sequelize: Sequelize, jobCode: string): Promise<JobLease | null> {
  const transaction = await sequelize.transaction();
  const rows = await sequelize.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($code)) AS ok', {
    type: QueryTypes.SELECT,
    bind: { code: `atlas:job:${jobCode}` },
    transaction,
  });
  if (!rows[0]?.ok) {
    await transaction.rollback();
    return null;
  }
  const [session] = await sequelize.query<{ pid: number }>('SELECT pg_backend_pid() AS pid', { type: QueryTypes.SELECT, transaction });
  return Object.freeze({ jobCode, sessionPid: Number(session?.pid), release: async () => transaction.commit() });
}

/** Ejecuta un handler con deadline y cancelación; devuelve `skipped` si otro worker tiene el lease. */
export async function runWithLease(
  sequelize: Sequelize,
  handler: JobHandler,
  tenantId: string,
): Promise<{ outcome: 'ran' | 'skipped' | 'timed_out' | 'failed'; result?: Record<string, unknown>; error?: string }> {
  const { descriptor } = handler;
  const lease =
    descriptor.concurrency === 'singleton'
      ? await acquireJobLease(sequelize, descriptor.jobCode)
      : Object.freeze({ jobCode: descriptor.jobCode, sessionPid: 0, release: async () => undefined });
  if (!lease) return { outcome: 'skipped' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), descriptor.deadlineMs);
  timer.unref();
  try {
    const result = await Promise.race([
      handler.run(tenantId, controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('JOB_DEADLINE_EXCEEDED')))),
    ]);
    return { outcome: 'ran', result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: message === 'JOB_DEADLINE_EXCEEDED' ? 'timed_out' : 'failed', error: message };
  } finally {
    clearTimeout(timer);
    await lease.release();
  }
}
