/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de resilience sin introducir reglas de un dominio específico.
 */
import { Injectable, Optional } from '@nestjs/common';
import { MetricsService } from '../observability/metrics.service.js';
import { AdapterError } from './adapter-error.js';
import { CircuitBreakerRegistry } from './circuit-breaker.js';
import { withRetry } from './retry.util.js';

export type ResilientExecuteOptions = {
  provider: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Timeout POR INTENTO en ms. Si un intento no resuelve en este plazo, se corta con un
   * AdapterError TIMEOUT (retryable) que alimenta el retry y el circuit breaker. Sin esto, un
   * adaptador cuyo fetch se cuelga retiene el intento indefinidamente y el breaker nunca cuenta el
   * fallo. Default 30s. Nota: el `fn` subyacente puede seguir vivo (no se cancela el socket); lo
   * que se garantiza es que el ejecutor libera el intento y contabiliza el fallo.
   */
  timeoutMs?: number;
};

const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;

function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, provider: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(
        new AdapterError({
          code: 'TIMEOUT',
          provider,
          message: `Intento excedió el timeout de ${timeoutMs}ms`,
          retryable: true,
        }),
      );
    }, timeoutMs);
    timer.unref?.();
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

/**
 * Punto de entrada único para que CUALQUIER adaptador (notificaciones, proveedores de datos
 * externos, uno nuevo) ejecute una llamada saliente con retry+backoff y circuit breaker por
 * proveedor, sin reimplementar ninguno de los dos. Un adaptador nuevo solo necesita llamar
 * `run(providerCode, fn)` — hereda la protección automáticamente.
 *
 * Fase 3.4: por ser el punto de entrada único, es también el lugar natural para las métricas de
 * negocio de salida — volumen/resultado por proveedor (proxy del costo) y estado del breaker.
 * `MetricsService` es `@Optional()` a propósito: este servicio se instancia sin argumentos en
 * varios tests de adaptadores, y la instrumentación no debe volverse un requisito para usarlo.
 */
@Injectable()
export class ResilientAdapterExecutorService {
  private readonly registry = new CircuitBreakerRegistry({ failureThreshold: 5, resetTimeoutMs: 60_000 });

  constructor(@Optional() private readonly metrics?: MetricsService) {}

  async run<T>(fn: () => Promise<T>, options: ResilientExecuteOptions): Promise<T> {
    const breaker = this.registry.getOrCreate(options.provider);
    const timeoutMs = options.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    try {
      const result = await breaker.execute(() =>
        withRetry(() => withTimeout(fn, timeoutMs, options.provider), {
          provider: options.provider,
          maxAttempts: options.maxAttempts ?? 3,
          baseDelayMs: options.baseDelayMs ?? 200,
          maxDelayMs: options.maxDelayMs ?? 5_000,
        }),
      );
      this.recordMetrics(options.provider, 'success');
      return result;
    } catch (error) {
      // `circuit_open` se distingue de `failure`: no es que el proveedor haya fallado ahora, es que
      // el breaker cortó la llamada antes de hacerla (y por tanto tampoco hubo costo).
      this.recordMetrics(options.provider, this.registry.getState(options.provider) === 'open' ? 'circuit_open' : 'failure');
      throw error;
    }
  }

  circuitStateFor(provider: string) {
    return this.registry.getState(provider);
  }

  /** Publica el resultado de la llamada + el estado del breaker resultante. No-op sin métricas. */
  private recordMetrics(provider: string, outcome: 'success' | 'failure' | 'circuit_open'): void {
    if (!this.metrics) return;
    this.metrics.recordProviderCall({ provider, outcome });
    this.metrics.setCircuitBreakerState({ provider, state: this.registry.getState(provider) });
  }
}
