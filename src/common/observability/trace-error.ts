/**
 * @file Registro uniforme de excepciones en un span, con código estable y sin filtrar mensajes.
 * @business Esta pieza reduce el tiempo de detección y recuperación de incidentes.
 * @system marca el span como fallido una sola vez, sin alterar el error ni el flujo de control.
 */
import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { APP_ATTRIBUTES } from '../../observability/telemetry.constants.js';

export type SpanErrorDetails = Readonly<{
  /** Código estable del dominio. Si se omite, se deduce del propio error. */
  code?: string;
  /** Si el fallo se cura reintentando. Distingue un corte de red de una entrada inválida. */
  retryable?: boolean;
}>;

/**
 * Marca un span como fallido a partir de una excepción.
 *
 * Registra la excepción UNA SOLA VEZ, en el span donde nace, y usa un CÓDIGO ESTABLE como
 * descripción del estado. El mensaje del error no sirve como descripción: en este backend puede
 * contener fragmentos del cuerpo de la petición —un documento de identidad, un teléfono— y nunca
 * debe salir hacia el sistema de trazas.
 *
 * No relanza ni silencia: quien llama conserva el control del flujo y el error original intacto.
 */
export function recordSpanError(span: Span, error: unknown, details: SpanErrorDetails = {}): void {
  const code = details.code ?? stableErrorCode(error);
  span.recordException(toRecordableError(error, code));
  span.setStatus({ code: SpanStatusCode.ERROR, message: code });
  span.setAttribute('error.type', code);
  const retryable = details.retryable ?? readRetryable(error);
  if (retryable !== undefined) span.setAttribute(APP_ATTRIBUTES.errorRetryable, retryable);
}

/**
 * Código estable y de baja cardinalidad.
 *
 * Se lee ESTRUCTURALMENTE de las propiedades que ya usan las jerarquías de error del repositorio
 * (`code`, y el `errorCode` de los errores de dominio). Leerlas así, y no con un `instanceof` por
 * cada una, evita que esta capa común dependa de ningún dominio: un módulo nuevo que respete la
 * convención queda bien clasificado sin tocar este archivo.
 */
export function stableErrorCode(error: unknown): string {
  return (
    readStringProperty(error, 'code') ??
    readStringProperty(error, 'errorCode') ??
    (error instanceof Error ? error.name || 'ERROR' : 'UNKNOWN_ERROR')
  );
}

function readRetryable(error: unknown): boolean | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as Record<string, unknown>).retryable;
  return typeof value === 'boolean' ? value : undefined;
}

function readStringProperty(error: unknown, key: string): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * `recordException` serializa el mensaje y la pila tal cual. Un valor lanzado que no sea un
 * `Error` —una cadena con datos del solicitante, por ejemplo— se sustituye por su código estable
 * para no filtrar contenido por esta vía.
 */
function toRecordableError(error: unknown, code: string): Error {
  return error instanceof Error ? error : new Error(code);
}

/**
 * Registra en el span activo el fallo que llegó al límite HTTP.
 *
 * Distingue quién se equivocó, porque en Jaeger no es lo mismo:
 *
 * - **5xx** — fallo NUESTRO: se registra la excepción y el span se marca `ERROR`. Es lo que
 *   debe aparecer en «trazas con error» y disparar una alerta.
 * - **4xx** — el llamante mandó algo inválido: se deja constancia del código en un atributo,
 *   pero el span NO se marca como error. Marcarlo haría que cada validación fallida —que en un
 *   backend público son miles al día— se contara como fallo del servicio, y la señal de error
 *   dejaría de significar nada.
 *
 * Actúa sobre el span ACTIVO, que en el límite HTTP es el del servidor. Un span de negocio más
 * interno ya registró su propia excepción al relanzarla, así que no hay registro duplicado
 * dentro de un mismo span: hay un rastro en cada nivel, que es justo lo que permite ver dónde
 * nació el fallo y por dónde salió.
 */
export function recordHttpFailure(statusCode: number, exception: unknown): void {
  const span = trace.getActiveSpan();
  if (span === undefined) return;
  if (statusCode >= 500) {
    recordSpanError(span, exception);
    return;
  }
  if (statusCode >= 400) span.setAttribute('error.type', stableErrorCode(exception));
}
