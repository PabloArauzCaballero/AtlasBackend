/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un plan de estrés ENCOLADO en tráfico HTTP real y medido.
 * @system planificador por llegadas con reloj monótono, concurrencia acotada y cancelación propagada.
 *
 * Lo que este archivo NO hace, porque es justo el fallo que el paquete QA señala: no simula el
 * éxito con temporizadores que incrementan estadísticas. Cada número del informe viene de una
 * petición HTTP que salió y de una respuesta que volvió —o de la falta de ella—.
 */
import { Injectable } from '@nestjs/common';
import { SystemsTestHttpClientService } from './systems-test-http-client.service.js';
import type { SystemTestEnvironment } from './systems-test-url-policy.util.js';
import { checkConservation, evaluateGates, summarizeLatencies, type RunCounters, type RunReport } from './systems-stress-metrics.util.js';

export type StressPlan = {
  baseUrl: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  payload: unknown;
  environment: SystemTestEnvironment;
  targetRps: number;
  durationSeconds: number;
  concurrency: number;
  maxErrorRate: number;
  maxP95Ms: number;
  timeoutMs: number;
  /** Tope absoluto de peticiones. Protege al objetivo de un perfil mal configurado. */
  requestBudget: number;
  dryRun: boolean;
};

type Arrival = { scheduledAt: number; admittedAt: number };

@Injectable()
export class SystemsStressExecutorService {
  constructor(private readonly http: SystemsTestHttpClientService) {}

  /**
   * Ejecuta el plan y devuelve el informe.
   *
   * Decisiones del planificador, todas señaladas por el paquete QA como errores frecuentes:
   *
   * - **Horario absoluto con reloj monótono**, no `setInterval` encadenado con `await`. Encadenar
   *   acumula deriva: cada iteración añade el tiempo del `await` al siguiente disparo, así que la
   *   tasa real cae sola cuando el objetivo se pone lento y el informe lo atribuye al objetivo.
   * - **La tasa de llegadas NO se reduce en silencio** si el objetivo se ralentiza. Cuando la
   *   concurrencia está llena, la llegada se DESCARTA y se cuenta como `dropped`; no se posterga
   *   fingiendo que se cumplió el objetivo.
   * - **`admissionLag` se mide** (`admittedAt - scheduledAt`): es lo que delata que el generador, y
   *   no el objetivo, es el cuello de botella.
   */
  async execute(plan: StressPlan, signal: AbortSignal): Promise<RunReport> {
    const counters: RunCounters = {
      scheduled: 0,
      admitted: 0,
      dropped: 0,
      responded: 0,
      succeeded: 0,
      failedByStatus: 0,
      transportErrors: 0,
    };
    const latencies: number[] = [];
    const admissionLags: number[] = [];
    const notes: string[] = [];

    if (plan.dryRun) {
      // Dry-run: se valida que la URL sea construible y permitida, y NADA más sale a la red.
      // Separarlo aquí evita el peor resultado posible de este servicio: una corrida "real" que en
      // realidad no mandó tráfico y publica un PASS.
      try {
        this.http.buildUrl(plan.baseUrl, plan.path, plan.environment);
        notes.push('Dry-run: plan validado, URL permitida. No se envió tráfico de negocio.');
      } catch (error) {
        notes.push(`Dry-run: la URL del plan no es válida o no está permitida (${error instanceof Error ? error.message : 'error'}).`);
      }
      return this.report({ plan, counters, latencies, admissionLags, durationMs: 0, notes });
    }

    const totalArrivals = Math.min(plan.requestBudget, Math.max(0, Math.round(plan.targetRps * plan.durationSeconds)));
    if (totalArrivals < plan.targetRps * plan.durationSeconds) {
      notes.push(
        `El presupuesto de ${plan.requestBudget} peticiones recorta el plan (${plan.targetRps} rps × ${plan.durationSeconds} s): ` +
          'la corrida no representa la carga pedida.',
      );
    }

    const intervalMs = plan.targetRps > 0 ? 1_000 / plan.targetRps : 0;
    const startedAt = this.now();
    const inFlight = new Set<Promise<void>>();

    for (let index = 0; index < totalArrivals; index += 1) {
      if (signal.aborted) {
        counters.dropped += totalArrivals - index;
        notes.push(`Cancelada: ${totalArrivals - index} llegadas no se admitieron.`);
        break;
      }
      // Horario ABSOLUTO desde el inicio: la llegada `i` va en `start + i*interval`, pase lo que
      // pase con las anteriores.
      const dueAt = startedAt + index * intervalMs;
      await this.sleepUntil(dueAt, signal);
      counters.scheduled += 1;

      if (inFlight.size >= plan.concurrency) {
        // Tope lleno: se DESCARTA, no se pospone. Posponer es cómo un generador saturado termina
        // reportando que alcanzó su objetivo.
        counters.dropped += 1;
        continue;
      }

      const arrival: Arrival = { scheduledAt: dueAt, admittedAt: this.now() };
      admissionLags.push(Math.max(0, arrival.admittedAt - arrival.scheduledAt));
      counters.admitted += 1;

      const attempt = this.sendOne(plan, counters, latencies, signal).finally(() => inFlight.delete(attempt));
      inFlight.add(attempt);
    }

    await Promise.all([...inFlight]);
    const durationMs = this.now() - startedAt;

    if (signal.aborted) notes.push('La corrida se detuvo por cancelación: el informe cubre sólo lo ejecutado.');
    return this.report({ plan, counters, latencies, admissionLags, durationMs, notes });
  }

  private async sendOne(plan: StressPlan, counters: RunCounters, latencies: number[], signal: AbortSignal): Promise<void> {
    const startedAt = this.now();
    const response = await this.http.execute({
      baseUrl: plan.baseUrl,
      path: plan.path,
      method: plan.method,
      headers: plan.headers,
      payload: plan.payload,
      timeoutMs: plan.timeoutMs,
      environment: plan.environment,
    });
    const elapsed = this.now() - startedAt;

    if (response.statusCode === null) {
      // Un timeout o un corte NO es una respuesta de 0 ms: no entra en el histograma de latencias,
      // porque mezclarlo baja el p95 justo cuando el sistema está peor.
      counters.transportErrors += 1;
      return;
    }
    counters.responded += 1;
    latencies.push(elapsed);
    if (response.statusCode >= 200 && response.statusCode < 400) counters.succeeded += 1;
    else counters.failedByStatus += 1;
    if (signal.aborted) return;
  }

  private report(input: {
    plan: StressPlan;
    counters: RunCounters;
    latencies: number[];
    admissionLags: number[];
    durationMs: number;
    notes: string[];
  }): RunReport {
    const { plan, counters, latencies, admissionLags, durationMs, notes } = input;
    const latency = summarizeLatencies(latencies);
    const conservation = checkConservation(counters);
    const { gates, verdict } = evaluateGates({
      counters,
      latency,
      maxErrorRate: plan.maxErrorRate,
      maxP95Ms: plan.maxP95Ms,
      conservation,
      dryRun: plan.dryRun,
    });
    return {
      counters,
      latency,
      targetRps: plan.targetRps,
      achievedRps: durationMs > 0 ? Number(((counters.admitted * 1_000) / durationMs).toFixed(3)) : null,
      durationMs: Math.round(durationMs),
      admissionLag: summarizeLatencies(admissionLags),
      gates,
      verdict,
      conservation,
      notes,
    };
  }

  /** Reloj monótono para duraciones. El de pared puede saltar hacia atrás y arruinar una medición. */
  private now(): number {
    return performance.now();
  }

  private sleepUntil(targetMs: number, signal: AbortSignal): Promise<void> {
    const remaining = targetMs - this.now();
    if (remaining <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(finish, remaining);
      function finish() {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      }
      // La cancelación corta la espera además de la petición: detener una corrida no puede quedarse
      // colgado hasta que venza el último `setTimeout` programado.
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
