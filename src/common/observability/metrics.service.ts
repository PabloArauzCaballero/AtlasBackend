/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de observability sin introducir reglas de un dominio específico.
 */
import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { readObservabilityConfig } from './observability.config.js';
import { env } from '../../config/env.js';
import { buildInfo } from '../../config/build-info.js';

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
  private readonly partnerOnboardingSteps: Counter<'step' | 'outcome'>;
  private readonly outboxPendingEvents: Gauge<'tenant_id'>;
  private readonly scheduledJobRuns: Counter<'job' | 'outcome'>;
  private readonly authAttemptsTotal: Counter<'actor_type' | 'outcome'>;

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

    /*
     * Onboarding del partner, paso a paso. Es un CONTADOR por paso y resultado y no un simple
     * total de altas porque la pregunta que hay que poder responder no es «¿cuántos comercios
     * entraron?» sino «¿dónde se caen?»: un embudo que pierde el 60 % en la subida del QR
     * bancario y otro que lo pierde en el alta son el mismo número de altas y dos problemas
     * completamente distintos.
     */
    this.partnerOnboardingSteps = new Counter({
      name: 'atlas_partner_onboarding_steps_total',
      help: 'Pasos del onboarding del partner por paso y resultado. Mide el embudo, no sólo el total de altas.',
      labelNames: ['step', 'outcome'],
      registers: [this.registry],
    });

    this.outboxPendingEvents = new Gauge({
      name: 'atlas_outbox_pending_events',
      help: 'Eventos del outbox en estado pending (profundidad del backlog) por tenant, medido en la última corrida del job.',
      labelNames: ['tenant_id'],
      registers: [this.registry],
    });

    // Hallazgo A-03: los jobs de fondo pasaron de "los dispara alguien a mano" a "corren solos". Sin
    // esta serie, un job que falla en cada tanda es indistinguible de uno que nadie llamó nunca:
    // ambos se ven como silencio. `rate(...{outcome="failure"}) > 0` es la alerta.
    this.scheduledJobRuns = new Counter({
      name: 'atlas_scheduled_job_runs_total',
      help: 'Ejecuciones de trabajos de fondo programados, por job y resultado.',
      labelNames: ['job', 'outcome'],
      registers: [this.registry],
    });

    // Hallazgo A-10: los intentos de login quedaban en `auth_events` (base), que sirve para
    // investigar UN caso pero no para ver un patrón. Un pico de `invalid_password` sobre muchos
    // identificadores es credential stuffing, y sin serie temporal nadie se entera en el momento.
    this.authAttemptsTotal = new Counter({
      name: 'atlas_auth_attempts_total',
      help: 'Intentos de login por tipo de actor y resultado (success o código de fallo).',
      labelNames: ['actor_type', 'outcome'],
      registers: [this.registry],
    });

    // Serie de identidad del proceso, siempre 1. Con la API y el worker desplegados por separado,
    // "el worker no está corriendo" es un fallo silencioso: nadie recibe un error, simplemente el
    // trabajo de fondo deja de ocurrir. `absent(atlas_app_info{role="worker"})` convierte ese
    // silencio en una alerta, y las etiquetas dicen además qué build hay desplegado en cada rol.
    new Gauge({
      name: 'atlas_app_info',
      help: 'Identidad del proceso: siempre 1, etiquetado por rol y build. Permite alertar sobre un rol ausente.',
      labelNames: ['role', 'version', 'commit'],
      registers: [this.registry],
    }).set({ role: env.APP_ROLE, version: buildInfo.version, commit: buildInfo.commit ?? 'unknown' }, 1);
  }

  /**
   * Registra el desenlace de una ejecución de un job programado:
   *
   * - `success` / `failure`: la tanda corrió (para un tenant) y terminó bien o mal.
   * - `skipped`: no arrancó porque la tanda anterior seguía en curso. No es un fallo, pero si
   *   domina la serie significa que el intervalo configurado es menor que la duración real del job.
   * - `stalled`: la tanda superó `RUNTIME_JOBS_TICK_TIMEOUT_MS`. Es la señal que convierte "el job
   *   dejó de correr" —el fallo más caro de un planificador, porque no produce ningún error— en
   *   algo alertable: `increase(atlas_scheduled_job_runs_total{outcome="stalled"}[15m]) > 0`.
   */
  recordScheduledJob(input: { job: string; outcome: 'success' | 'failure' | 'skipped' | 'stalled' }): void {
    this.scheduledJobRuns.inc({ job: input.job, outcome: input.outcome });
  }

  /**
   * Registra un intento de login. `outcome` es `success` o el código de fallo
   * (`actor_not_found`, `no_credentials`, `account_locked`, `invalid_password`): un conjunto
   * acotado, así que la cardinalidad de la serie está controlada.
   */
  recordAuthAttempt(input: { actorType: string; outcome: string }): void {
    this.authAttemptsTotal.inc({ actor_type: input.actorType, outcome: input.outcome });
  }

  /** Registra una llamada saliente a un proveedor externo. `outcome`: success | failure | circuit_open. */
  /**
   * Un paso del onboarding del partner terminó. `outcome` distingue el paso completado del que una
   * regla rechazó: los dos son información, y colapsarlos deja el embudo sin poder explicar por
   * qué se estrecha.
   */
  recordPartnerOnboardingStep(input: { step: string; outcome: 'ok' | 'rejected' }): void {
    this.partnerOnboardingSteps.inc({ step: input.step, outcome: input.outcome });
  }

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
