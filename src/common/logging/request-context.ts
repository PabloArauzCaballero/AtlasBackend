/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de logging sin introducir reglas de un dominio específico.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { trace } from '@opentelemetry/api';

/**
 * Contexto por-request propagado con AsyncLocalStorage (CLS). Permite que CUALQUIER `logger.log()`
 * de un servicio incluya el `correlationId` del request en curso, no solo el exception filter. Antes,
 * una línea de log de un servicio salía sin correlación, así que era imposible reconstruir la
 * secuencia de un request en el agregador (o en la colección Mongo de logs).
 *
 * El `trace_id` de OpenTelemetry se lee del span activo (si el tracing está habilitado), para poder
 * saltar de un log a su traza distribuida.
 */
type RequestContext = {
  correlationId: string;
  /**
   * Portal desde el que entró la petición (`x-atlas-product`), cuando lo declara.
   *
   * Viaja por el contexto y no como parámetro porque el único que lo necesita —la cabecera del
   * correo— está a cuatro capas del controlador, y hacerlo explícito obligaría a añadir un
   * argumento a cada servicio del camino sin que ninguno lo use.
   */
  product?: string | undefined;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Ejecuta `fn` con el contexto del request activo; todo el trabajo async descendiente lo hereda. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** correlationId del request en curso, o `undefined` fuera de un request (arranque, jobs, tests). */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/** Producto declarado por la petición en curso, o `undefined` fuera de un request. */
export function getRequestProduct(): string | undefined {
  return storage.getStore()?.product;
}

const EMPTY_TRACE_ID = '00000000000000000000000000000000';

/** trace_id del span OTel activo, o `undefined` si el tracing está deshabilitado o no hay span. */
export function getTraceId(): string | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || spanContext.traceId === EMPTY_TRACE_ID) return undefined;
  return spanContext.traceId;
}
