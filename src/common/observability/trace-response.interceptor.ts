/**
 * @file Publica el identificador de la traza en la respuesta HTTP para soporte técnico.
 * @business Esta pieza reduce el tiempo de detección y recuperación de incidentes.
 * @system fija la cabecera x-trace-id desde el contexto activo, nunca desde el cliente.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { TRACE_ID_HEADER } from '../../observability/telemetry.constants.js';
import { readActiveTraceId } from './trace-context.service.js';

/**
 * Es el puente entre un usuario que reporta un fallo y la traza que lo explica: soporte pide el
 * `x-trace-id` y lo busca en Jaeger, sin depender de que el incidente se pueda reproducir.
 *
 * El identificador procede SIEMPRE del contexto activo de OpenTelemetry, nunca de una cabecera
 * del cliente: un valor aportado por el llamante sería trivial de falsificar y no correspondería
 * a ninguna traza real. Cuando no hay traza —telemetría apagada o ruta excluida— la cabecera
 * simplemente no se emite; una vacía o inventada sería peor, porque mandaría a buscar algo que
 * no existe.
 *
 * El cuerpo JSON NO se toca: el contrato de respuesta no cambia por añadir trazabilidad. La
 * correlación de negocio sigue siendo `correlationId`, que ya viaja en cada error.
 */
@Injectable()
export class TraceResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // La cabecera se fija ANTES de ejecutar el manejador: después, la respuesta puede haberse
    // enviado ya —una descarga de documento, un stream— y escribir cabeceras sobre ella lanzaría.
    if (context.getType() === 'http') {
      const traceId = readActiveTraceId();
      const response = context.switchToHttp().getResponse<Response>();
      if (traceId !== undefined && !response.headersSent) {
        response.setHeader(TRACE_ID_HEADER, traceId);
      }
    }
    return next.handle();
  }
}
