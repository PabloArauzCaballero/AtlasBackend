/**
 * Contrato de error normalizado para CUALQUIER adaptador saliente del backend (proveedor de
 * notificaciones, proveedor de datos externos, o uno nuevo que se agregue después). El objetivo:
 * que el código que llama a un adaptador (`ExternalDataExecutionService`, los adapters de
 * `notifications`, o cualquier integración futura) pueda razonar sobre el error sin conocer los
 * detalles del proveedor subyacente — solo necesita `retryable` y `code`.
 */
export type AdapterErrorCode =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'AUTH_FAILED'
  | 'INVALID_RESPONSE'
  | 'CIRCUIT_OPEN'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN';

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  readonly cause: unknown;

  constructor(input: {
    code: AdapterErrorCode;
    provider: string;
    message: string;
    retryable: boolean;
    httpStatus?: number | null;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = 'AdapterError';
    this.code = input.code;
    this.provider = input.provider;
    this.retryable = input.retryable;
    this.httpStatus = input.httpStatus ?? null;
    this.cause = input.cause;
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, provider: this.provider, retryable: this.retryable, httpStatus: this.httpStatus, message: this.message };
  }
}

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message));
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code !== undefined && ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code);
}

/**
 * Qué significa un status HTTP de error para el llamador.
 *
 * La distinción que sostiene todo lo demás es `retryable`: reintentar un 401 no arregla una
 * credencial mala —sólo gasta cuota y retrasa la alerta— mientras que no reintentar un 503 convierte
 * un hipo del proveedor en un fallo para el cliente. Por eso vive en un solo sitio y no repartida
 * por cada adaptador, donde cada uno acabaría decidiéndolo distinto.
 */
function classifyHttpStatus(httpStatus: number): {
  code: AdapterErrorCode;
  retryable: boolean;
  fallbackMessage: (status: number) => string;
} {
  if (httpStatus === 401 || httpStatus === 403) {
    return { code: 'AUTH_FAILED', retryable: false, fallbackMessage: (status) => `HTTP ${status}` };
  }
  if (httpStatus === 429) {
    return { code: 'RATE_LIMITED', retryable: true, fallbackMessage: () => 'Rate limited' };
  }
  return {
    code: 'PROVIDER_ERROR',
    retryable: RETRYABLE_HTTP_STATUS.has(httpStatus),
    fallbackMessage: (status) => `HTTP ${status}`,
  };
}

/**
 * Traduce cualquier error/resultado crudo de un adaptador (excepción de red, respuesta HTTP con
 * status de error, o un error de dominio propio) al contrato normalizado. Centraliza la decisión
 * de "esto es reintentable" en un solo lugar en vez de repetirla en cada adaptador.
 */
export function toAdapterError(input: { provider: string; error?: unknown; httpStatus?: number | null; message?: string }): AdapterError {
  const { provider, error, httpStatus } = input;

  if (error instanceof AdapterError) return error;

  if (typeof httpStatus === 'number' && httpStatus >= 400) {
    const { code, retryable, fallbackMessage } = classifyHttpStatus(httpStatus);
    return new AdapterError({
      code,
      provider,
      message: input.message ?? fallbackMessage(httpStatus),
      retryable,
      httpStatus,
      cause: error,
    });
  }

  if (isAbortError(error)) {
    return new AdapterError({ code: 'TIMEOUT', provider, message: input.message ?? 'Request timed out', retryable: true, cause: error });
  }
  if (isNetworkError(error)) {
    return new AdapterError({ code: 'NETWORK', provider, message: input.message ?? 'Network error', retryable: true, cause: error });
  }

  return new AdapterError({
    code: 'UNKNOWN',
    provider,
    message: input.message ?? (error instanceof Error ? error.message : 'Unknown adapter error'),
    retryable: false,
    cause: error,
  });
}
