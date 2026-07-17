import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { readObservabilityConfig } from './observability.config.js';

/** Estado del circuit breaker, codificado numéricamente para poder graficarlo/alertar. */
const CIRCUIT_STATE_VALUE: Record<string, number> = { closed: 0, half_open: 1, open: 2 };

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
  private readonly providerCallsTotal: Counter<'provider' | 'outcome'>;
  private readonly circuitBreakerState: Gauge<'provider'>;
  private readonly outboxPendingEvents: Gauge<'tenant_id'>;

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

    // --- Métricas de NEGOCIO (Fase 3.4) --------------------------------------------------------
    // Las tres señales que el plan pide además de los SLO HTTP: costo/volumen por proveedor
    // externo, breaker abierto y profundidad del outbox.
    this.providerCallsTotal = new Counter({
      name: 'atlas_provider_calls_total',
      help: 'Llamadas salientes a proveedores externos por proveedor y resultado. Proxy del costo: cada llamada a un buró/KYC se cobra.',
      labelNames: ['provider', 'outcome'],
      registers: [this.registry],
    });

    this.circuitBreakerState = new Gauge({
      name: 'atlas_circuit_breaker_state',
      help: 'Estado del circuit breaker por proveedor: 0=closed, 1=half_open, 2=open.',
      labelNames: ['provider'],
      registers: [this.registry],
    });

    this.outboxPendingEvents = new Gauge({
      name: 'atlas_outbox_pending_events',
      help: 'Eventos del outbox en estado pending (profundidad del backlog) por tenant, medido en la última corrida del job.',
      labelNames: ['tenant_id'],
      registers: [this.registry],
    });
  }

  /** Registra una llamada saliente a un proveedor externo. `outcome`: success | failure | circuit_open. */
  recordProviderCall(input: { provider: string; outcome: 'success' | 'failure' | 'circuit_open' }): void {
    this.providerCallsTotal.inc({ provider: input.provider, outcome: input.outcome });
  }

  /** Publica el estado actual del circuit breaker de un proveedor (alertable: `== 2` es abierto). */
  setCircuitBreakerState(input: { provider: string; state: string }): void {
    this.circuitBreakerState.set({ provider: input.provider }, CIRCUIT_STATE_VALUE[input.state] ?? 0);
  }

  /** Publica la profundidad del backlog del outbox de un tenant (medida al correr el job). */
  setOutboxPendingEvents(input: { tenantId: string; pending: number }): void {
    this.outboxPendingEvents.set({ tenant_id: input.tenantId }, input.pending);
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
