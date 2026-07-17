import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { readObservabilityConfig } from './observability.config.js';

/**
 * Registro central de métricas Prometheus (Fase 3.4 del plan 10/10). Expone:
 *  - Métricas por defecto de Node/proceso (heap, event loop lag, GC, CPU) vía `collectDefaultMetrics`.
 *  - `http_requests_total` y `http_request_duration_seconds`, alimentadas por `HttpMetricsInterceptor`.
 *
 * El SLO de latencia (p50/p95/p99) y la tasa de error del plan se derivan del histograma y el
 * counter con las funciones `histogram_quantile` / `rate` de PromQL sobre estas series.
 */
@Injectable()
export class MetricsService {
  readonly registry: Registry;
  readonly contentType: string;

  private readonly httpRequestsTotal: Counter<'method' | 'route' | 'status_code'>;
  private readonly httpRequestDuration: Histogram<'method' | 'route' | 'status_code'>;

  constructor() {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ service: readObservabilityConfig().serviceName });
    this.contentType = this.registry.contentType;

    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total de requests HTTP procesados, por método, ruta y código de estado.',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duración de los requests HTTP en segundos, por método, ruta y código de estado.',
      labelNames: ['method', 'route', 'status_code'],
      // Buckets pensados para una API web: desde 5 ms hasta 5 s.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
  }

  /** Registra un request HTTP completado. `durationSeconds` viene del interceptor (fin - inicio). */
  observeHttpRequest(input: { method: string; route: string; statusCode: number; durationSeconds: number }): void {
    const labels = { method: input.method, route: input.route, status_code: String(input.statusCode) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, input.durationSeconds);
  }

  /** Devuelve el cuerpo de texto en formato de exposición Prometheus para `GET /metrics`. */
  render(): Promise<string> {
    return this.registry.metrics();
  }
}
