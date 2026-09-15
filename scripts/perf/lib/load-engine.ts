/**
 * Motor de carga de MODELO ABIERTO: las peticiones llegan a un ritmo fijo, independientemente de lo
 * que tarde el backend en contestar.
 *
 * La alternativa —N trabajadores en bucle cerrado, que es lo que hace `scripts/stress/`— tiene un
 * defecto que invalida la medición de latencia: si el servidor se ralentiza, los trabajadores
 * mandan menos peticiones, la carga baja sola y el sistema nunca llega a saturarse. El resultado es
 * un p95 optimista que no se parece a lo que ve el tráfico real, donde los usuarios siguen llegando
 * aunque el backend vaya lento. Para medir latencia bajo carga hace falta el modelo abierto; el
 * cerrado sigue siendo el correcto para verificar un pipeline de trabajo, y por eso el stress de
 * notificaciones se queda como está.
 *
 * Contra el crecimiento sin techo hay `maxInFlight`: al alcanzarlo, la petición se cuenta como
 * `dropped` y no se envía. Un `dropped > 0` NO es un fallo del script — es la señal de que el
 * backend ya no absorbe el ritmo ofrecido, y se reporta como tal.
 */
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import type { LoadFlow } from './load-flows.js';
import { pickFlow } from './load-flows.js';

export type ScenarioShape = {
  arrivalRatePerSecond: number;
  durationSeconds: number;
  warmupSeconds: number;
  maxInFlight: number;
};

export type RequestOutcome = {
  flow: string;
  latencyMs: number;
  status: number | null;
  /** `null` = la petición salió bien según el contrato del flujo. */
  failure: 'http-status' | 'timeout' | 'network' | null;
  duringWarmup: boolean;
};

export type FlowStats = {
  flow: string;
  count: number;
  errors: number;
  p50Ms: number;
  p75Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

export type LoadResult = {
  shape: ScenarioShape;
  /** Duración real medida, no la nominal: si el bucle se retrasó, el throughput debe reflejarlo. */
  measuredWindowSeconds: number;
  attempted: number;
  dropped: number;
  completed: number;
  errors: { total: number; byKind: Record<string, number>; serverErrors: number; timeouts: number };
  throughputPerSecond: number;
  errorRatePercent: number;
  overall: FlowStats;
  perFlow: FlowStats[];
  /** Retraso acumulado del planificador de llegadas: si crece, el generador es el cuello, no el backend. */
  schedulerLagMs: { p95: number; max: number };
};

export type ExecuteRequest = (flow: LoadFlow) => Promise<{ status: number | null; failure: RequestOutcome['failure'] }>;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

function statsFor(flow: string, samples: number[], errors: number): FlowStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    flow,
    count: samples.length,
    errors,
    p50Ms: percentile(sorted, 50),
    p75Ms: percentile(sorted, 75),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.length > 0 ? Math.round(sorted[sorted.length - 1] * 100) / 100 : 0,
  };
}

/**
 * Ejecuta un escenario completo.
 *
 * Las muestras del warm-up se descartan del cálculo: el primer tramo mide compilación JIT, llenado
 * del pool de conexiones y cachés frías, no el estado estacionario. Se siguen enviando porque
 * calentar es justamente su propósito.
 */
export async function runLoadScenario(input: {
  shape: ScenarioShape;
  flows: readonly LoadFlow[];
  execute: ExecuteRequest;
  onProgress?: (elapsedSeconds: number, snapshot: { completed: number; errors: number; inFlight: number }) => void;
}): Promise<LoadResult> {
  const { shape, flows, execute } = input;
  const intervalMs = 1000 / shape.arrivalRatePerSecond;
  const totalMs = (shape.warmupSeconds + shape.durationSeconds) * 1000;
  const warmupMs = shape.warmupSeconds * 1000;

  const outcomes: RequestOutcome[] = [];
  const schedulerLags: number[] = [];
  const inFlightSet = new Set<Promise<void>>();

  let attempted = 0;
  let dropped = 0;
  let errorCount = 0;
  let lastProgressSecond = -1;

  const started = performance.now();
  let measurementStartedAt: number | null = null;

  for (let index = 0; ; index += 1) {
    const scheduledAt = started + index * intervalMs;
    const now = performance.now();
    if (now - started >= totalMs) break;

    // Retraso del propio generador. Si es alto, el cuello está en este proceso (event loop saturado
    // por miles de promesas) y cualquier latencia medida está inflada por nosotros, no por el backend.
    const lag = now - scheduledAt;
    if (lag > 0) schedulerLags.push(lag);
    else await sleep(-lag);

    const elapsed = performance.now() - started;
    const duringWarmup = elapsed < warmupMs;
    if (!duringWarmup && measurementStartedAt === null) measurementStartedAt = performance.now();

    if (inFlightSet.size >= shape.maxInFlight) {
      dropped += 1;
      continue;
    }

    attempted += 1;
    const flow = pickFlow(flows, index);
    const requestStarted = performance.now();
    const task = execute(flow)
      .then((result) => {
        const outcome: RequestOutcome = {
          flow: flow.name,
          latencyMs: performance.now() - requestStarted,
          status: result.status,
          failure: result.failure,
          duringWarmup,
        };
        if (outcome.failure !== null && !duringWarmup) errorCount += 1;
        outcomes.push(outcome);
      })
      .finally(() => {
        inFlightSet.delete(task);
      });
    inFlightSet.add(task);

    const second = Math.floor(elapsed / 1000);
    if (input.onProgress && second !== lastProgressSecond) {
      lastProgressSecond = second;
      input.onProgress(second, { completed: outcomes.length, errors: errorCount, inFlight: inFlightSet.size });
    }
  }

  // Se espera a que drene lo que sigue en vuelo: descartarlo sesgaría el resultado justo hacia las
  // peticiones lentas, que son las que aún no han vuelto.
  await Promise.allSettled([...inFlightSet]);
  const measuredWindowSeconds = measurementStartedAt === null ? 0 : (performance.now() - measurementStartedAt) / 1000;

  const measured = outcomes.filter((outcome) => !outcome.duringWarmup);
  const successes = measured.filter((outcome) => outcome.failure === null);

  const byKind: Record<string, number> = {};
  for (const outcome of measured) {
    if (outcome.failure) byKind[outcome.failure] = (byKind[outcome.failure] ?? 0) + 1;
  }

  const perFlow = flows.map((flow) => {
    const own = measured.filter((outcome) => outcome.flow === flow.name);
    return statsFor(
      flow.name,
      own.filter((outcome) => outcome.failure === null).map((outcome) => outcome.latencyMs),
      own.filter((outcome) => outcome.failure !== null).length,
    );
  });

  const lagsSorted = [...schedulerLags].sort((a, b) => a - b);

  return {
    shape,
    measuredWindowSeconds: Math.round(measuredWindowSeconds * 100) / 100,
    attempted,
    dropped,
    completed: measured.length,
    errors: {
      total: measured.length - successes.length,
      byKind,
      serverErrors: measured.filter((outcome) => outcome.status !== null && outcome.status >= 500).length,
      timeouts: measured.filter((outcome) => outcome.failure === 'timeout').length,
    },
    throughputPerSecond: measuredWindowSeconds > 0 ? Math.round((successes.length / measuredWindowSeconds) * 100) / 100 : 0,
    errorRatePercent: measured.length > 0 ? Math.round(((measured.length - successes.length) / measured.length) * 10000) / 100 : 0,
    overall: statsFor(
      '__all__',
      successes.map((outcome) => outcome.latencyMs),
      measured.length - successes.length,
    ),
    perFlow,
    schedulerLagMs: { p95: percentile(lagsSorted, 95), max: lagsSorted.at(-1) ?? 0 },
  };
}
