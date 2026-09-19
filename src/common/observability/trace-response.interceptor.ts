/**
 * @file Publica el identificador de la traza en la respuesta HTTP para soporte técnico.
 * @business Esta pieza reduce el tiempo de detección y recuperación de incidentes.
 * @system fija la cabecera x-trace-id desde el contexto activo, nunca desde el cliente.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { publishTraceIdHeader } from './trace-id-header.js';

/**
 * Es el puente entre un usuario que reporta un fallo y la traza que lo explica: soporte pide el
 * `x-trace-id` y lo busca en Jaeger, sin depender de que el incidente se pueda reproducir.
 *
 * Cubre el camino FELIZ. El de error lo cubre el filtro de excepciones, porque los guards de
 * NestJS corren antes que los interceptores y un 401 nunca pasaría por aquí. Ver
 * `trace-id-header.ts`.
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
      publishTraceIdHeader(context.switchToHttp().getResponse<Response>());
    }
    return next.handle();
  }
}
