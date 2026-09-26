/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */

/**
 * Métricas de una corrida de carga, con sus denominadores a la vista.
 *
 * Las tres reglas que este archivo existe para hacer cumplir, todas del paquete QA:
 *
 * 1. **Un percentil sin muestras no es un percentil.** Un p99 calculado sobre diez peticiones se
 *    pinta igual de convincente que uno sobre diez mil, y no dice nada. Aquí el resultado incluye
 *    `sampleCount` y un `insufficientSamples` explícito; quien lo lea tiene que decidir, no adivinar.
 * 2. **Los timeouts y los descartes no se borran del gráfico.** Quitarlos no los convierte en éxito:
 *    van en sus propias cuentas y en el denominador que les toca.
 * 3. **La conservación se comprueba.** `scheduled = admitted + dropped`. Si no cuadra, el informe lo
 *    dice en vez de publicar una tasa de éxito calculada sobre un denominador que se perdió por el
 *    camino.
 */

export type LatencySummary = {
  count: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  /** Verdadero cuando hay tan pocas muestras que los percentiles no son informativos. */
  insufficientSamples: boolean;
};

/** Debajo de esto, un p95 es una anécdota con formato de estadística. */
export const MIN_SAMPLES_FOR_PERCENTILES = 30;

/**
 * Percentil por rango más cercano sobre las muestras ordenadas.
 *
 * No se interpolan valores: con latencias medidas, un p95 «entre» dos observaciones es un número
 * que nadie observó. Y NUNCA se promedian percentiles de dos ventanas o de dos workers —el error
 * clásico— porque aquí sólo entra la lista cruda de muestras.
 */
function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function summarizeLatencies(samplesMs: readonly number[]): LatencySummary {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? null,
    insufficientSamples: sorted.length < MIN_SAMPLES_FOR_PERCENTILES,
  };
}

export type RunCounters = {
  /** Llegadas que el plan programó en la ventana. */
  scheduled: number;
  /** Llegadas que el ejecutor llegó a lanzar. */
  admitted: number;
  /** Llegadas descartadas a propósito por el tope de concurrencia o por el presupuesto. */
  dropped: number;
  /** Respuestas con código HTTP, sea cual sea. */
  responded: number;
  /** Respuestas 2xx/3xx. */
  succeeded: number;
  /** Respuestas 4xx/5xx. */
  failedByStatus: number;
  /** Intentos sin código: timeout, corte, DNS. No son "0 ms", son otra categoría. */
  transportErrors: number;
};

export type RunVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NOT_EVALUATED';

export type RunGate = {
  name: string;
  observed: number | null;
  threshold: number;
  passed: boolean | null;
  detail: string;
};

export type RunReport = {
  counters: RunCounters;
  latency: LatencySummary;
  /** Llegadas por segundo realmente conseguidas, frente al objetivo. */
  targetRps: number;
  achievedRps: number | null;
  durationMs: number;
  /** `admittedAt - scheduledAt` de cada llegada: delata que el generador no da abasto. */
  admissionLag: LatencySummary;
  gates: RunGate[];
  verdict: RunVerdict;
  conservation: { ok: boolean; detail: string };
  notes: string[];
};

/** `scheduled = admitted + dropped`. Si no cuadra, el informe lo dice. */
export function checkConservation(counters: RunCounters): { ok: boolean; detail: string } {
  const sum = counters.admitted + counters.dropped;
  if (sum === counters.scheduled) return { ok: true, detail: `scheduled=${counters.scheduled} = admitted+dropped` };
  return {
    ok: false,
    detail: `scheduled=${counters.scheduled} pero admitted+dropped=${sum}: faltan ${counters.scheduled - sum} llegadas sin explicar.`,
  };
}

/**
 * Evalúa los umbrales del perfil y decide el veredicto.
 *
 * `INCONCLUSIVE` no es un empate cortés: es lo que corresponde cuando la corrida no produjo datos
 * suficientes para afirmar ni desmentir el umbral. El paquete QA es explícito en que una corrida sin
 * volumen suficiente queda inconclusa, no aprobada; publicar PASS ahí es la forma más barata de
 * tener un pipeline verde que no mide nada.
 *
 * Un fallo de conservación también es INCONCLUSIVE: una tasa de error calculada sobre un
 * denominador que se perdió por el camino no se puede comparar con nada.
 */
export function evaluateGates(input: {
  counters: RunCounters;
  latency: LatencySummary;
  maxErrorRate: number;
  maxP95Ms: number;
  conservation: { ok: boolean; detail: string };
  dryRun: boolean;
}): { gates: RunGate[]; verdict: RunVerdict } {
  // Un dry-run no manda tráfico de negocio: valida el plan. Nunca es un PASS de extremo a extremo.
  if (input.dryRun) {
    return {
      gates: [],
      verdict: 'NOT_EVALUATED',
    };
  }

  const attempts = input.counters.responded + input.counters.transportErrors;
  const errorRate = attempts === 0 ? null : (input.counters.failedByStatus + input.counters.transportErrors) / attempts;

  const gates: RunGate[] = [
    {
      name: 'error_rate',
      observed: errorRate,
      threshold: input.maxErrorRate,
      // Sin un solo intento no hay tasa que comparar. `null` es "no se sabe", no "cero".
      passed: errorRate === null ? null : errorRate <= input.maxErrorRate,
      detail:
        errorRate === null
          ? 'No hubo ningún intento HTTP: no hay tasa de error que evaluar.'
          : `${(errorRate * 100).toFixed(2)} % de ${attempts} intentos (fallos por estado + errores de transporte).`,
    },
    {
      name: 'latency_p95_ms',
      observed: input.latency.p95,
      threshold: input.maxP95Ms,
      passed: input.latency.p95 === null || input.latency.insufficientSamples ? null : input.latency.p95 <= input.maxP95Ms,
      detail: input.latency.insufficientSamples
        ? `Muestra insuficiente: ${input.latency.count} respuestas, mínimo ${MIN_SAMPLES_FOR_PERCENTILES} para publicar un p95.`
        : `p95 = ${input.latency.p95} ms sobre ${input.latency.count} respuestas.`,
    },
  ];

  if (!input.conservation.ok) return { gates, verdict: 'INCONCLUSIVE' };
  if (gates.some((gate) => gate.passed === false)) return { gates, verdict: 'FAIL' };
  if (gates.some((gate) => gate.passed === null)) return { gates, verdict: 'INCONCLUSIVE' };
  return { gates, verdict: 'PASS' };
}
