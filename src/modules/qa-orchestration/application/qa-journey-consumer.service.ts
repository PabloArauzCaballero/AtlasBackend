/**
 * @file Servicio de aplicación: el worker que CONSUME las corridas QA encoladas.
 * @business Esta pieza hace que una corrida siga aunque se cierre el portal, y que si el worker
 *   muere otro la retome sin duplicar efectos.
 * @system `system_job_runs` con claim `SKIP LOCKED`, lease renovado por heartbeat y fencing en
 *   cada escritura; mismo patrón que el consumidor de estrés.
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import { DurableJobQueue, type ClaimedJob } from '../../../platform/jobs/durable-job-queue.js';
import { QA_JOURNEY_JOB_CODE } from '../infrastructure/qa-run-admission.repository.js';
import { QaRunSupportRepository } from '../infrastructure/qa-run-support.repository.js';
import { QaRunExecutionService } from './qa-run-execution.service.js';

const LEASE_MS = 60_000;
const HEARTBEAT_MS = 15_000;
const MAX_ATTEMPTS = 3;

@Injectable()
export class QaJourneyConsumerService implements OnModuleDestroy {
  private readonly logger = new Logger(QaJourneyConsumerService.name);
  private readonly owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly queue: DurableJobQueue;
  /** Corrida en vuelo en ESTE proceso. Vive fuera de la tanda del planificador (ver `drain`). */
  private active: Promise<string> | null = null;
  private readonly shutdown = new AbortController();

  constructor(
    @InjectConnection() sequelize: Sequelize,
    private readonly runs: QaRunSupportRepository,
    private readonly execution: QaRunExecutionService,
  ) {
    this.queue = new DurableJobQueue(sequelize, {
      schema: atlasSchemaFor('system_job_runs'),
      leaseMs: LEASE_MS,
      maxAttempts: MAX_ATTEMPTS,
    });
  }

  /**
   * Una vuelta: late (readiness real) y, si este proceso está libre, reclama UNA corrida.
   *
   * La corrida NO se espera dentro de la tanda: dura minutos y el planificador abandona las tandas
   * que superan `RUNTIME_JOBS_TICK_TIMEOUT_MS`, lo que dejaría la siguiente vuelta reclamando una
   * segunda corrida en paralelo. Una por proceso: cada corrida ya genera su concurrencia acotada.
   */
  async drain(): Promise<{ claimed: number; busy: boolean }> {
    await this.runs.workerHeartbeat(this.owner, process.env.APP_VERSION ?? process.env.GIT_SHA ?? 'dev');
    if (this.active || this.shutdown.signal.aborted) return { claimed: 0, busy: Boolean(this.active) };
    const job = await this.queue.claim([QA_JOURNEY_JOB_CODE], this.owner);
    if (!job) return { claimed: 0, busy: false };
    this.active = this.runClaimed(job, this.shutdown.signal).finally(() => {
      this.active = null;
    });
    return { claimed: 1, busy: true };
  }

  /** Al apagar: se deja de admitir y el lease vence; otro worker retoma desde el checkpoint. */
  async onModuleDestroy(): Promise<void> {
    this.shutdown.abort();
    await this.active?.catch(() => undefined);
  }

  private async runClaimed(job: ClaimedJob, signal: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const cancel = () => controller.abort('SHUTDOWN');
    signal.addEventListener('abort', cancel, { once: true });
    const heartbeat = setInterval(() => {
      void this.runs.workerHeartbeat(this.owner, 'dev').catch(() => undefined);
      void this.queue.heartbeat(job).then((stillOwner) => {
        if (stillOwner) return;
        this.logger.warn(`Lease perdido en la corrida QA del job ${job.jobRunId}: otro worker la tomó. Se abandona aquí.`);
        controller.abort('LOST_LEASE');
      });
    }, HEARTBEAT_MS);
    heartbeat.unref();
    const fence = { jobRunId: job.jobRunId, fencingToken: job.fencingToken };
    try {
      const qaRunId = String((job.inputJson ?? {}).qaRunId ?? '');
      const outcome = await this.execution.execute(qaRunId, fence, controller.signal);
      if (outcome.kind === 'ABANDONED') {
        // Apagado ordenado: se devuelve a la cola para que otro worker la retome ya desde el
        // checkpoint. Lease perdido: otro ya es el dueño y no se toca nada.
        if (outcome.reason === 'SHUTDOWN') await this.queue.release(job);
        return outcome.reason;
      }
      const confirmed = await this.queue.complete(job, {
        status: outcome.jobStatus,
        resultJson: { qaRunId, runStatus: outcome.runStatus, verdict: outcome.verdict },
      });
      return confirmed ? outcome.runStatus : 'LOST_LEASE';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'QA_RUN_FAILED';
      this.logger.error(`Corrida QA del job ${job.jobRunId} falló por infraestructura: ${message}`);
      // La corrida no puede quedarse en RUNNING para siempre: se cierra con el motivo, cercada.
      await this.execution.failInfrastructure(String((job.inputJson ?? {}).qaRunId ?? ''), fence, message).catch(() => undefined);
      await this.queue.complete(job, { status: 'failed', errorMessage: message }).catch(() => false);
      return 'FAILED_INFRASTRUCTURE';
    } finally {
      clearInterval(heartbeat);
      signal.removeEventListener('abort', cancel);
    }
  }
}
