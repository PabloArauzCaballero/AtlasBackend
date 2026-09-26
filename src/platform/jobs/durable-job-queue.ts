/**
 * @file Consumo durable de `system_job_runs`: claim atómico, lease, heartbeat y fencing.
 * @business Un plan de estrés encolado se EJECUTA; si el worker muere a mitad, otro lo retoma; y un
 *   worker que perdió su lease no puede confirmar progreso viejo encima del nuevo.
 * @system `FOR UPDATE SKIP LOCKED` sobre la fila más antigua reclamable, token de fencing desde una
 *   secuencia, y guarda de fencing en cada escritura posterior.
 *
 * Complementa a `job-registry.ts`, que resuelve otro problema: allí el lease es POR JOB —"sólo un
 * worker corre el barrido de outbox"— y se apoya en un bloqueo consultivo. Aquí el lease es POR
 * FILA, porque la cola tiene trabajos distintos que varios workers pueden repartirse a la vez.
 *
 * Por qué `SKIP LOCKED` y no `FOR UPDATE` a secas: con N workers pidiendo trabajo al mismo tiempo,
 * `FOR UPDATE` los pone en fila detrás del primero y el paralelismo desaparece justo cuando hace
 * falta. `SKIP LOCKED` hace que cada uno se lleve una fila distinta sin esperar a nadie.
 *
 * Por qué fencing además de lease: un lease vencido significa "asumo que el dueño murió", pero no lo
 * garantiza — puede estar pausado por GC, por swap o por una pausa de la VM. Cuando vuelve, cree que
 * sigue siendo el dueño. El token creciente por reclamo es lo que convierte esa creencia en un
 * `UPDATE` de cero filas en vez de en una confirmación que pisa el trabajo del worker nuevo.
 */
import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

export type ClaimedJob = {
  jobRunId: string;
  jobCode: string;
  tenantId: string | null;
  inputJson: Record<string, unknown> | null;
  attempt: number;
  /** Token creciente de ESTE reclamo. Sin él no se puede escribir nada más sobre la fila. */
  fencingToken: string;
  leaseExpiresAt: Date;
};

type Row = {
  _id: string;
  job_code: string;
  _tenant_id: string | null;
  input_json: Record<string, unknown> | null;
  attempts: number;
  fencing_token: string;
  lease_expires_at: Date;
};

export type DurableJobQueueOptions = {
  schema: string;
  /** Cuánto dura un lease sin renovar. Pasado eso, otro worker puede reclamar la fila. */
  leaseMs: number;
  /** Tope de reclamos por fila. Un trabajo que revienta siempre no puede reclamarse para siempre. */
  maxAttempts: number;
};

export class DurableJobQueue {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly options: DurableJobQueueOptions,
  ) {}

  private get table(): string {
    return `${this.options.schema}.system_job_runs`;
  }

  private get sequence(): string {
    return `${this.options.schema}.system_job_runs_fencing_seq`;
  }

  /**
   * Reclama UNA fila y devuelve su token de fencing, o `null` si no hay trabajo.
   *
   * Reclamable es: encolada, o en ejecución con el lease vencido —o sea, un worker que murió—. El
   * `ORDER BY _created_at` hace la cola justa; `SKIP LOCKED` hace que N workers no se estorben.
   *
   * El `attempts + 1 <= maxAttempts` del `WHERE` interior es deliberadamente del lado del filtro y
   * no del `UPDATE`: una fila que agotó sus intentos deja de ser candidata, en vez de reclamarse y
   * abandonarse en cada vuelta del bucle.
   */
  async claim(jobCodes: readonly string[], owner: string, now: Date = new Date()): Promise<ClaimedJob | null> {
    if (jobCodes.length === 0) return null;
    const leaseExpiresAt = new Date(now.getTime() + this.options.leaseMs);
    const rows = await this.sequelize.query<Row>(
      `UPDATE ${this.table} AS runs
          SET status = 'running',
              claimed_by = $owner,
              lease_expires_at = $leaseExpiresAt,
              heartbeat_at = $now,
              started_at = COALESCE(runs.started_at, $now),
              fencing_token = nextval('${this.sequence}'),
              attempts = runs.attempts + 1
        WHERE runs._id = (
                SELECT candidate._id
                  FROM ${this.table} AS candidate
                 WHERE candidate.job_code = ANY($jobCodes)
                   AND candidate.attempts < $maxAttempts
                   AND (candidate.status = 'queued'
                        OR (candidate.status = 'running' AND candidate.lease_expires_at IS NOT NULL AND candidate.lease_expires_at < $now))
                 ORDER BY candidate._created_at ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED
              )
    RETURNING runs._id, runs.job_code, runs._tenant_id, runs.input_json, runs.attempts, runs.fencing_token, runs.lease_expires_at;`,
      {
        type: QueryTypes.SELECT,
        bind: { owner, leaseExpiresAt, now, jobCodes: [...jobCodes], maxAttempts: this.options.maxAttempts },
      },
    );
    const row = rows[0];
    if (!row) return null;
    return {
      jobRunId: String(row._id),
      jobCode: row.job_code,
      tenantId: row._tenant_id === null ? null : String(row._tenant_id),
      inputJson: row.input_json,
      attempt: Number(row.attempts),
      fencingToken: String(row.fencing_token),
      leaseExpiresAt: new Date(row.lease_expires_at),
    };
  }

  /**
   * Renueva el lease. Devuelve `false` si ESTE worker ya no es el dueño — y entonces tiene que
   * abandonar el trabajo, no terminarlo: otro ya lo está corriendo.
   */
  async heartbeat(job: ClaimedJob, now: Date = new Date()): Promise<boolean> {
    // `RETURNING _id` + SELECT en vez del contador de filas del driver: ese contador viaja en el
    // segundo elemento de la tupla de Sequelize y su forma depende del dialecto, así que `=== 1`
    // sobre él es una comprobación que puede ser verdadera por accidente. Las filas devueltas no.
    const rows = await this.sequelize.query<{ _id: string }>(
      `UPDATE ${this.table}
          SET heartbeat_at = $now, lease_expires_at = $leaseExpiresAt
        WHERE _id = $id AND fencing_token = $token AND status = 'running'
    RETURNING _id;`,
      {
        type: QueryTypes.SELECT,
        bind: { now, leaseExpiresAt: new Date(now.getTime() + this.options.leaseMs), id: job.jobRunId, token: job.fencingToken },
      },
    );
    return rows.length === 1;
  }

  /**
   * Cierra el trabajo. La guarda de fencing está en el `WHERE`, no en un `if` previo: entre leer y
   * escribir puede haber pasado cualquier cosa, y sólo la base puede decidir esto sin carrera.
   *
   * Devuelve `false` cuando el `UPDATE` no tocó ninguna fila, que es exactamente el caso del worker
   * viejo intentando confirmar: se reporta, no se ignora.
   */
  async complete(
    job: ClaimedJob,
    outcome: { status: 'completed' | 'failed'; resultJson?: Record<string, unknown>; errorMessage?: string },
    now: Date = new Date(),
    transaction?: Transaction,
  ): Promise<boolean> {
    const rows = await this.sequelize.query<{ _id: string }>(
      `UPDATE ${this.table}
          SET status = $status,
              completed_at = $now,
              result_json = $resultJson,
              error_message = $errorMessage,
              lease_expires_at = NULL
        WHERE _id = $id AND fencing_token = $token
    RETURNING _id;`,
      {
        type: QueryTypes.SELECT,
        bind: {
          status: outcome.status,
          now,
          resultJson: outcome.resultJson === undefined ? null : JSON.stringify(outcome.resultJson),
          errorMessage: outcome.errorMessage ?? null,
          id: job.jobRunId,
          token: job.fencingToken,
        },
        transaction,
      },
    );
    return rows.length === 1;
  }

  /**
   * Devuelve el trabajo a la cola sin consumir su lease. Se usa al apagar ordenadamente: es mejor
   * que otro worker lo tome ya, en vez de esperar a que venza el lease de un proceso que ya no está.
   */
  async release(job: ClaimedJob): Promise<boolean> {
    const rows = await this.sequelize.query<{ _id: string }>(
      `UPDATE ${this.table}
          SET status = 'queued', claimed_by = NULL, lease_expires_at = NULL
        WHERE _id = $id AND fencing_token = $token AND status = 'running'
    RETURNING _id;`,
      { type: QueryTypes.SELECT, bind: { id: job.jobRunId, token: job.fencingToken } },
    );
    return rows.length === 1;
  }

  /**
   * Trabajos abandonados: en ejecución, con el lease vencido y sin intentos disponibles. Son los que
   * ningún worker va a volver a tomar, y por eso hay que poder verlos: un trabajo que nadie ejecuta
   * y que nadie reporta es peor que uno fallido.
   */
  async listAbandoned(jobCodes: readonly string[], now: Date = new Date()): Promise<Array<{ jobRunId: string; attempts: number }>> {
    if (jobCodes.length === 0) return [];
    const rows = await this.sequelize.query<{ _id: string; attempts: number }>(
      `SELECT _id, attempts
         FROM ${this.table}
        WHERE job_code = ANY($jobCodes)
          AND status = 'running'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < $now
          AND attempts >= $maxAttempts
        ORDER BY _created_at ASC
        LIMIT 100;`,
      { type: QueryTypes.SELECT, bind: { jobCodes: [...jobCodes], now, maxAttempts: this.options.maxAttempts } },
    );
    return rows.map((row) => ({ jobRunId: String(row._id), attempts: Number(row.attempts) }));
  }

  /** Profundidad de cola: trabajo persistido listo, separado de lo que está en vuelo. */
  async depth(jobCodes: readonly string[], now: Date = new Date()): Promise<{ queued: number; running: number; expired: number }> {
    if (jobCodes.length === 0) return { queued: 0, running: 0, expired: 0 };
    const rows = await this.sequelize.query<{ queued: string; running: string; expired: string }>(
      `SELECT
          COUNT(*) FILTER (WHERE status = 'queued') AS queued,
          COUNT(*) FILTER (WHERE status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at >= $now)) AS running,
          COUNT(*) FILTER (WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < $now) AS expired
         FROM ${this.table}
        WHERE job_code = ANY($jobCodes);`,
      { type: QueryTypes.SELECT, bind: { jobCodes: [...jobCodes], now } },
    );
    const row = rows[0];
    return { queued: Number(row?.queued ?? 0), running: Number(row?.running ?? 0), expired: Number(row?.expired ?? 0) };
  }
}
