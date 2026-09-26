/**
 * El cliente HTTP de UNA persona. Cada actor tiene su sesión; ninguno hereda la del operador.
 *
 * Es la regla que más fácil se rompe sin querer en un motor de carga: se autentica una vez con un
 * usuario cómodo y se reutiliza ese token para las mil personas. El resultado parece tráfico
 * realista y no lo es — mide la ruta de un solo actor mil veces, no mil actores —, y además
 * atraviesa autorizaciones que en producción habrían rechazado a esa persona.
 *
 * Aquí el token vive DENTRO del actor y no hay forma de compartirlo por accidente.
 */

export type StepOutcome = {
  stepKey: string;
  method: string;
  path: string;
  /** Transporte: el código HTTP, o `null` si no hubo respuesta (timeout, corte). */
  httpStatus: number | null;
  /** Milisegundos del intento. No incluye think time. */
  latencyMs: number;
  /** Veredicto de NEGOCIO, separado del transporte: un 200 puede ser un fallo y un 409 un acierto. */
  outcome: 'PASSED' | 'FAILED' | 'SKIPPED_DEPENDENCY' | 'INDETERMINATE';
  expected: string;
  actual: string;
  /** Motivo legible cuando no pasó. Sin cuerpos: sólo lo necesario para diagnosticar. */
  reason?: string;
};

export type ActorOptions = {
  baseUrl: string;
  tenantId: string;
  personaKey: string;
  /** Contexto de corrida hacia el emulador, si la corrida declaró namespace. */
  runHeaders?: Record<string, string>;
  timeoutMs: number;
};

export class HttpActor {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  readonly outcomes: StepOutcome[] = [];
  /** Recursos que ESTA persona adquirió por HTTP. Es el ledger que permite limpiar sólo lo suyo. */
  readonly resources: Record<string, string> = {};

  constructor(private readonly options: ActorOptions) {}

  get token(): string | null {
    return this.accessToken;
  }

  setSession(tokens: { accessToken?: string; refreshToken?: string } | null | undefined): void {
    if (!tokens) return;
    if (tokens.accessToken) this.accessToken = tokens.accessToken;
    if (tokens.refreshToken) this.refreshToken = tokens.refreshToken;
  }

  get storedRefreshToken(): string | null {
    return this.refreshToken;
  }

  /**
   * Un intento HTTP. Devuelve SIEMPRE, incluso ante error de transporte: el fallo es un dato de la
   * corrida, no una excepción que tumbe a la persona entera.
   */
  async request(input: {
    stepKey: string;
    method: string;
    path: string;
    body?: unknown;
    auth?: boolean;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<{ status: number | null; body: Record<string, unknown> | null; latencyMs: number; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const abort = () => controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    const started = performance.now();
    try {
      const response = await fetch(`${this.options.baseUrl}${input.path}`, {
        method: input.method,
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': this.options.tenantId,
          ...(input.auth !== false && this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          ...(input.idempotencyKey ? { 'x-idempotency-key': input.idempotencyKey } : {}),
          // Contexto de corrida: lo consume el emulador para aislar estado y dejar evidencia. No
          // viaja la Authorization del actor hacia el emulador — eso lo decide el backend.
          ...(this.options.runHeaders ?? {}),
          'x-mock-persona-key': this.options.personaKey,
          'x-mock-logical-operation-id': input.stepKey,
        },
        body: input.method === 'GET' || input.method === 'HEAD' ? undefined : JSON.stringify(input.body ?? {}),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed, latencyMs: performance.now() - started };
    } catch (error) {
      // Sin código HTTP: no es un "200 lento" ni un "0 ms". Es otra categoría y se reporta aparte.
      return {
        status: null,
        body: null,
        latencyMs: performance.now() - started,
        error: error instanceof Error ? (error.name === 'AbortError' ? 'TIMEOUT' : error.message) : 'UNKNOWN',
      };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
    }
  }

  record(outcome: StepOutcome): void {
    this.outcomes.push(outcome);
  }

  /** Marca los pasos que no se intentaron porque su dependencia falló. Nunca suman a `passed`. */
  skipRemaining(steps: Array<{ stepKey: string; method: string; path: string }>, reason: string): void {
    for (const step of steps) {
      this.outcomes.push({
        stepKey: step.stepKey,
        method: step.method,
        path: step.path,
        httpStatus: null,
        latencyMs: 0,
        outcome: 'SKIPPED_DEPENDENCY',
        expected: 'no evaluado',
        actual: 'no ejecutado',
        reason,
      });
    }
  }
}

/** Cuerpo de respuesta de Atlas: `{ requestId, data, timestamp }` o `{ requestId, error }`. */
export function dataOf(body: Record<string, unknown> | null): Record<string, unknown> {
  const data = body?.data;
  return data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

export function errorCodeOf(body: Record<string, unknown> | null): string | null {
  const error = body?.error;
  if (error === null || typeof error !== 'object') return null;
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' ? code : null;
}
