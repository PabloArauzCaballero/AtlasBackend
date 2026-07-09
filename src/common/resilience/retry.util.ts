import { AdapterError, toAdapterError } from './adapter-error.js';

export type RetryOptions = {
  /** Intentos totales, incluyendo el primero. 1 = sin reintento. */
  maxAttempts: number;
  /** Delay base en ms; el backoff es exponencial: base * 2^(intento-1). */
  baseDelayMs: number;
  /** Techo del delay, para que el backoff no crezca sin límite. */
  maxDelayMs?: number;
  /** Jitter proporcional (0-1) para evitar que reintentos sincronizados golpeen el proveedor a la vez. */
  jitterRatio?: number;
  provider: string;
  /** Inyectable para tests — evita esperas reales en la suite. */
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, options: RetryOptions): number {
  const raw = options.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(raw, options.maxDelayMs ?? Number.POSITIVE_INFINITY);
  const jitterRatio = options.jitterRatio ?? 0.2;
  const jitter = capped * jitterRatio * Math.random();
  return Math.round(capped + jitter);
}

/**
 * Ejecuta `fn` con reintento y backoff exponencial + jitter. Reutilizable por CUALQUIER
 * adaptador (notificaciones, proveedores externos, uno nuevo) — la decisión de "esto es
 * reintentable" vive en `AdapterError.retryable`, no en este archivo, así que agregar un
 * adaptador nuevo no requiere tocar esta función.
 *
 * `fn` debe lanzar un `AdapterError` (o cualquier error, que se normaliza vía `toAdapterError`)
 * cuando falla — nunca debe devolver un resultado "fallido" silenciosamente, o el retry no puede
 * distinguir éxito de fracaso.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError: AdapterError | null = null;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const adapterError = toAdapterError({ provider: options.provider, error });
      lastError = adapterError;
      const isLastAttempt = attempt === options.maxAttempts;
      if (!adapterError.retryable || isLastAttempt) {
        throw adapterError;
      }
      await sleep(backoffDelay(attempt, options));
    }
  }

  // Inalcanzable: el bucle siempre retorna o lanza en el último intento. Se deja como red de
  // seguridad explícita en vez de un `as never` que oculte un cambio futuro accidental del bucle.
  throw lastError ?? toAdapterError({ provider: options.provider, message: 'RETRY_LOOP_EXHAUSTED_WITHOUT_ERROR' });
}
