import { AdapterError } from './adapter-error.js';

export type CircuitState = 'closed' | 'open' | 'half_open';

export type CircuitBreakerOptions = {
  provider: string;
  /** Fallos consecutivos antes de abrir el circuito. */
  failureThreshold: number;
  /** Tiempo que el circuito permanece abierto antes de permitir un intento de prueba (half-open). */
  resetTimeoutMs: number;
  /** Reloj inyectable para tests deterministas. */
  now?: () => number;
};

/**
 * Circuit breaker en memoria, por instancia de proceso, para un único proveedor. No persiste a
 * base de datos a propósito — es un mecanismo de protección local del proceso Node (evitar que un
 * proveedor caído/lento acumule requests colgados), complementario al circuit breaker basado en
 * histórico de BD que ya existe para `external-data`
 * (`ExternalDataExecutionService.evaluateCircuitBreaker`, basado en conteo de fallos persistidos
 * en una ventana de tiempo) — ese sigue siendo la fuente de verdad para auditoría/reporting entre
 * réplicas; este es una capa de protección adicional, más rápida, dentro del mismo proceso.
 *
 * Estados: `closed` (normal) -> `open` (bloquea todo, tras N fallos consecutivos) ->
 * `half_open` (tras `resetTimeoutMs`, permite UN intento de prueba) -> `closed` si ese intento
 * tiene éxito, o vuelve a `open` si falla.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  getState(): CircuitState {
    if (this.state === 'open' && this.openedAt !== null && this.now() - this.openedAt >= this.options.resetTimeoutMs) {
      return 'half_open';
    }
    return this.state;
  }

  private assertClosedEnough(): void {
    const currentState = this.getState();
    if (currentState === 'open') {
      throw new AdapterError({
        code: 'CIRCUIT_OPEN',
        provider: this.options.provider,
        message: `Circuito abierto para ${this.options.provider} tras ${this.consecutiveFailures} fallos consecutivos.`,
        retryable: false,
      });
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
    this.openedAt = null;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.getState() === 'half_open' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.assertClosedEnough();
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}

/**
 * Registro de circuit breakers, uno por `providerCode`, para que cualquier familia de adaptador
 * (notificaciones, proveedores externos, futuro) comparta el mismo mecanismo sin reimplementarlo.
 * Inyectable como singleton de Nest (`@Injectable`) para que el estado persista entre llamadas
 * dentro del mismo proceso.
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly defaults: Omit<CircuitBreakerOptions, 'provider'>) {}

  getOrCreate(provider: string, overrides?: Partial<Omit<CircuitBreakerOptions, 'provider'>>): CircuitBreaker {
    const existing = this.breakers.get(provider);
    if (existing) return existing;
    const breaker = new CircuitBreaker({ ...this.defaults, ...overrides, provider });
    this.breakers.set(provider, breaker);
    return breaker;
  }

  getState(provider: string): CircuitState | 'never_used' {
    return this.breakers.get(provider)?.getState() ?? 'never_used';
  }
}
