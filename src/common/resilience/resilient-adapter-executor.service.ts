import { Injectable } from '@nestjs/common';
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
 */
@Injectable()
export class ResilientAdapterExecutorService {
  private readonly registry = new CircuitBreakerRegistry({ failureThreshold: 5, resetTimeoutMs: 60_000 });

  async run<T>(fn: () => Promise<T>, options: ResilientExecuteOptions): Promise<T> {
    const breaker = this.registry.getOrCreate(options.provider);
    return breaker.execute(() =>
      withRetry(fn, {
        provider: options.provider,
        maxAttempts: options.maxAttempts ?? 3,
        baseDelayMs: options.baseDelayMs ?? 200,
        maxDelayMs: options.maxDelayMs ?? 5_000,
      }),
    );
  }

  circuitStateFor(provider: string) {
    return this.registry.getState(provider);
  }
}
