/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza CONSUME los planes de estrés encolados y los ejecuta de verdad.
 * @system reclama de `system_job_runs` con lease y fencing, ejecuta con heartbeat y cierra con
 *   resultado durable.
 *
 * El hueco que cierra, textual del código que reemplaza: `SystemsStressRunService.queueStressRun`
 * inserta la fila con la nota «Fase 4 solo encola el plan de stress. La ejecución real debe hacerla
 * un worker externo controlado». Ese worker no existía en ningún repositorio —`systems_stress_run`
 * aparecía sólo en el servicio que crea la fila, en su unitaria y en una semilla de demo—, así que
 * la pantalla decía `queued: true` y ahí terminaba todo. Guardar un trabajo no es ejecutarlo.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { SystemEndpointCatalogModel } from '../../database/models/index.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { DurableJobQueue, type ClaimedJob } from '../../platform/jobs/durable-job-queue.js';
import { SystemsStressExecutorService, type StressPlan } from './systems-stress-executor.service.js';
import type { SystemTestEnvironment } from './systems-test-url-policy.util.js';
import type { RunReport } from './systems-stress-metrics.util.js';

export const STRESS_JOB_CODE = 'systems_stress_run';

/** Cuánto vive un lease sin renovar y cada cuánto se renueva. El heartbeat va muy por debajo. */
const LEASE_MS = 60_000;
const HEARTBEAT_MS = 15_000;
const MAX_ATTEMPTS = 3;

@Injectable()
export class SystemsStressConsumerService {
  private readonly logger = new Logger(SystemsStressConsumerService.name);
  /** Identidad de ESTE proceso. Va en `claimed_by` para poder rastrear quién tomó qué. */
  private readonly owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly queue: DurableJobQueue;

  constructor(
    @InjectConnection() sequelize: Sequelize,
    @InjectModel(SystemEndpointCatalogModel) private readonly endpoints: typeof SystemEndpointCatalogModel,
    private readonly executor: SystemsStressExecutorService,
  ) {
    this.queue = new DurableJobQueue(sequelize, {
      schema: atlasSchemaFor('system_job_runs'),
      leaseMs: LEASE_MS,
      maxAttempts: MAX_ATTEMPTS,
    });
  }

  /**
   * Una tanda: reclama hasta `maxJobs` planes y los ejecuta en serie.
   *
   * En serie a propósito. Cada plan ya genera su propia concurrencia contra el objetivo; ejecutar
   * dos planes a la vez en el mismo proceso multiplicaría la carga real por dos sin que ningún
   * límite del perfil lo refleje, que es exactamente el error de "sumar semáforos locales" que el
   * paquete QA señala.
   */
  async drain(signal: AbortSignal, maxJobs = 1): Promise<{ claimed: number; completed: number; failed: number; lostLease: number }> {
    const outcome = { claimed: 0, completed: 0, failed: 0, lostLease: 0 };
    for (let index = 0; index < maxJobs; index += 1) {
      if (signal.aborted) break;
      const job = await this.queue.claim([STRESS_JOB_CODE], this.owner);
      if (!job) break;
      outcome.claimed += 1;
      const result = await this.runClaimed(job, signal);
      if (result === 'lost_lease') outcome.lostLease += 1;
      else if (result === 'completed') outcome.completed += 1;
      else outcome.failed += 1;
    }
    return outcome;
  }

  private async runClaimed(job: ClaimedJob, signal: AbortSignal): Promise<'completed' | 'failed' | 'lost_lease'> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });

    // El heartbeat renueva el lease mientras la corrida dura. Si devuelve `false`, este worker ya no
    // es el dueño: se ABANDONA la corrida en vez de terminarla, porque otro ya la está ejecutando.
    const heartbeat = setInterval(() => {
      void this.queue.heartbeat(job).then((stillOwner) => {
        if (stillOwner) return;
        this.logger.warn(`Lease perdido en jobRun ${job.jobRunId}: otro worker lo tomó. Se cancela la ejecución local.`);
        controller.abort();
      });
    }, HEARTBEAT_MS);
    heartbeat.unref();

    try {
      const plan = await this.buildPlan(job);
      const report = await this.executor.execute(plan, controller.signal);
      const confirmed = await this.queue.complete(job, { status: 'completed', resultJson: this.resultOf(report, plan) });
      if (!confirmed) {
        // `complete` devolvió false: el `UPDATE` no tocó ninguna fila porque el token de fencing ya
        // no es el vigente. No se reintenta ni se fuerza: el dueño actual manda.
        this.logger.warn(`jobRun ${job.jobRunId}: fencing rechazó la confirmación. El resultado local se descarta.`);
        return 'lost_lease';
      }
      return 'completed';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'STRESS_RUN_FAILED';
      const confirmed = await this.queue.complete(job, { status: 'failed', errorMessage: message });
      return confirmed ? 'failed' : 'lost_lease';
    } finally {
      clearInterval(heartbeat);
      signal.removeEventListener('abort', cancel);
    }
  }

  /**
   * Traduce el `inputJson` de la fila a un plan ejecutable.
   *
   * Las restricciones de producción se vuelven a comprobar AQUÍ, no sólo al encolar: entre el
   * encolado y la ejecución puede pasar cualquier cosa, y el paquete QA pide explícitamente
   * conservar el bloqueo de `PRODUCTION_READONLY` en vez de quitarlo para conseguir una corrida
   * verde.
   */
  private async buildPlan(job: ClaimedJob): Promise<StressPlan> {
    const input = job.inputJson ?? {};
    const environment = String(input.environment ?? 'LOCAL') as SystemTestEnvironment;
    if (environment === 'PRODUCTION_READONLY') throw new Error('STRESS_RUNS_ARE_BLOCKED_IN_PRODUCTION');

    const endpointId = input.endpointId === undefined ? null : String(input.endpointId);
    if (!endpointId) throw new Error('STRESS_RUN_WITHOUT_ENDPOINT');
    const endpoint = await this.endpoints.findByPk(endpointId);
    if (!endpoint) throw new Error(`STRESS_RUN_ENDPOINT_NOT_FOUND:${endpointId}`);

    const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl ? input.baseUrl : endpoint.backendBaseUrl;
    if (!baseUrl) throw new Error('STRESS_RUN_WITHOUT_BASE_URL');

    const config = (input.config ?? {}) as Record<string, unknown>;
    const targetRps = this.positiveInt(input.targetRps, 1);
    const durationSeconds = this.positiveInt(input.durationSeconds, 1);
    return {
      baseUrl,
      path: endpoint.routePath,
      method: endpoint.method,
      // Las cabeceras guardadas están SANEADAS: `queueStressRun` reemplaza `authorization` y
      // similares por `[REDACTED]`. Reenviarlas tal cual mandaría esa cadena como si fuera una
      // credencial; se filtran para que el objetivo responda 401 de verdad y no por un token falso.
      headers: this.usableHeaders((input.headers ?? {}) as Record<string, unknown>),
      payload: config.payload ?? {},
      environment,
      targetRps,
      durationSeconds,
      concurrency: this.positiveInt(input.concurrency, 1),
      maxErrorRate: typeof input.maxErrorRate === 'number' ? input.maxErrorRate : 0.05,
      maxP95Ms: this.positiveInt(input.maxP95Ms, 1_000),
      timeoutMs: this.positiveInt(config.timeoutMs, 10_000),
      // Tope duro por encima del plan: protege al objetivo de un perfil mal configurado.
      requestBudget: this.positiveInt(config.requestBudget, Math.min(50_000, targetRps * durationSeconds)),
      dryRun: input.dryRun !== false,
    };
  }

  /** `[REDACTED]` no autentica nada: se descarta en vez de reenviarse como si fuera un valor. */
  private usableHeaders(headers: Record<string, unknown>): Record<string, string> {
    const usable: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string' || value === '[REDACTED]') continue;
      usable[key] = value;
    }
    return usable;
  }

  private positiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private resultOf(report: RunReport, plan: StressPlan): Record<string, unknown> {
    return {
      ...report,
      executedBy: this.owner,
      mode: plan.dryRun ? 'DRY_RUN' : 'REAL',
      target: { baseUrl: plan.baseUrl, path: plan.path, method: plan.method, environment: plan.environment },
    };
  }
}
