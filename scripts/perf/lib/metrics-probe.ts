/**
 * Lectura de `GET /metrics` del propio backend antes y después de una corrida de carga.
 *
 * Es la diferencia entre "el p95 subió" y "el p95 subió porque el pool estaba agotado". El
 * generador de carga sólo ve el lado cliente: sin estas series, ninguna corrida puede atribuir la
 * latencia a una causa, y el procedimiento exige causa raíz, no síntoma.
 *
 * Todas las series que se leen aquí ya las publica el backend hoy (`MetricsService`,
 * `DbPoolMetricsService` y las métricas por defecto de prom-client). Este módulo no añade
 * instrumentación: la consume.
 */

export type BackendMetricsSample = {
  reachable: boolean;
  heapUsedBytes: number | null;
  residentMemoryBytes: number | null;
  eventLoopLagP99Seconds: number | null;
  dbPoolUsing: number | null;
  dbPoolWaiting: number | null;
  dbPoolSize: number | null;
  /** Series que se buscaron y no aparecieron. Que falte una es un hueco de observabilidad, no un cero. */
  missingSeries: string[];
};

/** Extrae el valor de una serie sin etiquetas (`nombre valor`). */
function readSimple(body: string, name: string): number | null {
  const match = new RegExp(`^${name}(?:\\{[^}]*\\})? ([0-9.eE+-]+)$`, 'm').exec(body);
  return match ? Number(match[1]) : null;
}

/** Extrae el valor de una serie filtrando por una etiqueta concreta. */
function readLabelled(body: string, name: string, label: string, value: string): number | null {
  const match = new RegExp(`^${name}\\{[^}]*${label}="${value}"[^}]*\\} ([0-9.eE+-]+)$`, 'm').exec(body);
  return match ? Number(match[1]) : null;
}

const UNREACHABLE: BackendMetricsSample = {
  reachable: false,
  heapUsedBytes: null,
  residentMemoryBytes: null,
  eventLoopLagP99Seconds: null,
  dbPoolUsing: null,
  dbPoolWaiting: null,
  dbPoolSize: null,
  missingSeries: [],
};

/**
 * `origin` es el host sin el prefijo de la API: `/metrics` está excluido de `API_PREFIX` en
 * `src/main.ts:72` para respetar la convención de scrape de Prometheus.
 */
export async function sampleBackendMetrics(origin: string, timeoutMs = 5000): Promise<BackendMetricsSample> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body: string;
  try {
    const response = await fetch(`${origin.replace(/\/+$/, '')}/metrics`, { signal: controller.signal });
    if (!response.ok) return UNREACHABLE;
    body = await response.text();
  } catch {
    // El endpoint puede estar detrás de red aislada o el proceso no responder. Se reporta como no
    // alcanzable para que el informe lo diga, en vez de rellenar ceros que parecerían medidas.
    return UNREACHABLE;
  } finally {
    clearTimeout(timer);
  }

  const sample: BackendMetricsSample = {
    reachable: true,
    heapUsedBytes: readSimple(body, 'nodejs_heap_size_used_bytes'),
    residentMemoryBytes: readSimple(body, 'process_resident_memory_bytes'),
    eventLoopLagP99Seconds: readSimple(body, 'nodejs_eventloop_lag_p99_seconds'),
    dbPoolUsing: readLabelled(body, 'atlas_db_pool_connections', 'state', 'using'),
    dbPoolWaiting: readLabelled(body, 'atlas_db_pool_connections', 'state', 'waiting'),
    dbPoolSize: readLabelled(body, 'atlas_db_pool_connections', 'state', 'size'),
    missingSeries: [],
  };

  const expected: [string, number | null][] = [
    ['nodejs_heap_size_used_bytes', sample.heapUsedBytes],
    ['process_resident_memory_bytes', sample.residentMemoryBytes],
    ['nodejs_eventloop_lag_p99_seconds', sample.eventLoopLagP99Seconds],
    ['atlas_db_pool_connections{state="waiting"}', sample.dbPoolWaiting],
  ];
  sample.missingSeries = expected.filter(([, value]) => value === null).map(([name]) => name);
  return sample;
}

export function heapGrowthPercent(before: BackendMetricsSample, after: BackendMetricsSample): number | null {
  if (!before.reachable || !after.reachable) return null;
  if (before.heapUsedBytes === null || after.heapUsedBytes === null || before.heapUsedBytes === 0) return null;
  return Math.round(((after.heapUsedBytes - before.heapUsedBytes) / before.heapUsedBytes) * 10000) / 100;
}
