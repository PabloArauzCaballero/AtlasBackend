import { Injectable, Optional } from '@nestjs/common';
import { MetricsService } from '../observability/metrics.service.js';
import { CircuitBreakerRegistry } from './circuit-breaker.js';
import { withRetry } from './retry.util.js';

export type ResilientExecuteOptions = {
  provider: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

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
    try {
      const result = await breaker.execute(() =>
        withRetry(fn, {
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
