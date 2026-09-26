/**
 * @file Política de reintento, orden por agregado y DLQ (AT-036). Funciones puras.
 * @business Un fallo transitorio se reintenta con espera creciente y aleatoria; un fallo permanente va a
 *   la cola de mensajes muertos sin bucle; un evento que llega antes que su predecesor espera.
 * @system Sin base ni reloj: recibe intentos, límites y versiones y devuelve decisiones.
 */
export type RetryDecision = Readonly<{ action: 'retry'; availableAt: Date } | { action: 'dead_letter'; reason: string }>;

export type RetryPolicy = Readonly<{ maxAttempts: number; baseDelayMs: number; maxDelayMs: number; jitterRatio: number }>;

/** Token para inyectar una política distinta de la de defecto (pruebas, operación). */
export const RETRY_POLICY = 'atlas.platform.retry-policy';

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 60_000,
  maxDelayMs: 3_600_000,
  jitterRatio: 0.2,
});

/** Errores permanentes: reintentar no cambia el resultado. Se reconocen por código/prefijo, no por texto libre. */
export const PERMANENT_ERROR_CODES = new Set([
  'EVENT_UNKNOWN_SCHEMA_VERSION',
  'EVENT_INVALID_SCOPE',
  'EVENT_FORBIDDEN_PAYLOAD_KEY',
  'CONSUMER_REJECTED_PERMANENTLY',
]);

export function isPermanent(error: { code?: string; permanent?: boolean } | null | undefined): boolean {
  if (!error) return false;
  if (error.permanent === true) return true;
  return error.code !== undefined && PERMANENT_ERROR_CODES.has(error.code);
}

/** Backoff exponencial con jitter; `random` inyectable para pruebas deterministas. */
export function decideRetry(input: {
  attempts: number;
  now: Date;
  error?: { code?: string; permanent?: boolean } | null;
  policy?: RetryPolicy;
  random?: () => number;
}): RetryDecision {
  const policy = input.policy ?? DEFAULT_RETRY_POLICY;
  if (isPermanent(input.error)) return { action: 'dead_letter', reason: input.error?.code ?? 'PERMANENT' };
  if (input.attempts >= policy.maxAttempts) return { action: 'dead_letter', reason: `MAX_ATTEMPTS_${policy.maxAttempts}` };
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, input.attempts - 1));
  const jitter = (input.random ?? Math.random)() * policy.jitterRatio * exponential;
  return { action: 'retry', availableAt: new Date(input.now.getTime() + exponential + jitter) };
}

export type OrderDecision = Readonly<{ action: 'apply' } | { action: 'wait'; missing: number[] } | { action: 'stale' }>;

/**
 * Orden por agregado, no global. `lastApplied` es la última versión que el consumidor aplicó para ese
 * agregado (`null` si ninguna). Un hueco se espera (el relay reintenta más tarde); una versión ya
 * aplicada es obsoleta y se descarta como duplicado lógico. Sin versión (fila legacy) se aplica.
 */
export function decideOrder(input: { lastApplied: number | null; incoming: number | null }): OrderDecision {
  if (input.incoming === null) return { action: 'apply' };
  if (input.lastApplied === null)
    return input.incoming === 1 ? { action: 'apply' } : { action: 'wait', missing: range(1, input.incoming - 1) };
  if (input.incoming <= input.lastApplied) return { action: 'stale' };
  if (input.incoming === input.lastApplied + 1) return { action: 'apply' };
  return { action: 'wait', missing: range(input.lastApplied + 1, input.incoming - 1) };
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let value = from; value <= to; value += 1) out.push(value);
  return out;
}

export type ReplayAuthorization = Readonly<
  { allowed: true } | { allowed: false; code: 'REPLAY_PERMISSION_DENIED' | 'REPLAY_TENANT_MISMATCH' }
>;

export const REPLAY_PERMISSION = 'events.dead_letter.replay';

/** Un replay administrativo exige permiso y mismo tenant que el evento; se audita fuera de aquí. */
export function authorizeReplay(
  actor: { tenantId: string | null; permissions: readonly string[] },
  event: { tenantId: string | null },
): ReplayAuthorization {
  if (!actor.permissions.includes(REPLAY_PERMISSION)) return { allowed: false, code: 'REPLAY_PERMISSION_DENIED' };
  if (event.tenantId !== null && actor.tenantId !== event.tenantId) return { allowed: false, code: 'REPLAY_TENANT_MISMATCH' };
  return { allowed: true };
}
