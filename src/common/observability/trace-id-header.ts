/**
 * Publica el identificador de la traza en la respuesta HTTP.
 *
 * Vive aparte del interceptor porque hacen falta DOS puntos de emisión, y descubrirlo costó
 * ejecutarlo: en NestJS los **guards corren antes que los interceptores**, así que un 401 o un
 * 403 rechazado por un guard salta directo al filtro de excepciones y el interceptor no llega a
 * ejecutarse nunca. La respuesta salía sin cabecera justo en el caso en que soporte más la
 * necesita —«no me deja entrar»—, y eso no se ve compilando: se ve pidiendo la cabecera y
 * encontrándola vacía.
 *
 * Es idempotente: el interceptor la fija en el camino feliz y el filtro en el de error, y
 * escribir dos veces el mismo valor no tiene efecto.
 */
import { TRACE_ID_HEADER } from '../../observability/telemetry.constants.js';
import { readActiveTraceId } from './trace-context.service.js';

type ConCabeceras = { headersSent: boolean; setHeader: (nombre: string, valor: string) => unknown };

/**
 * @returns `true` si la cabecera se emitió.
 *
 * El identificador procede SIEMPRE del contexto activo de OpenTelemetry, nunca de una cabecera
 * del cliente: un valor aportado por el llamante sería trivial de falsificar y no
 * correspondería a ninguna traza real. Sin traza —telemetría apagada, ruta excluida— no se
 * emite nada: una cabecera vacía o inventada mandaría a buscar algo que no existe.
 */
export function publishTraceIdHeader(response: ConCabeceras): boolean {
  const traceId = readActiveTraceId();
  // Sobre una respuesta ya enviada —una descarga, un stream— escribir cabeceras lanzaría.
  if (traceId === undefined || response.headersSent) return false;
  response.setHeader(TRACE_ID_HEADER, traceId);
  return true;
}
