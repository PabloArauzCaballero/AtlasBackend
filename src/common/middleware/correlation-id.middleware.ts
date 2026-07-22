import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '../logging/request-context.js';

type RequestWithCorrelationId = {
  headers: Record<string, string | string[] | undefined>;
  correlationId?: string;
};

type Response = {
  setHeader: (name: string, value: string) => void;
};

/**
 * Solo se acepta un x-correlation-id entrante si es un token corto y seguro. Un header arbitrario
 * del cliente acabaría en logs y en el header de respuesta (inyección de logs / header splitting);
 * si no cumple el formato, se genera uno nuevo en vez de propagarlo.
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: RequestWithCorrelationId, res: Response, next: () => void): void {
    const incoming = req.headers['x-correlation-id'];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const correlationId = candidate && CORRELATION_ID_PATTERN.test(candidate) ? candidate : randomUUID();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    // Se entra al contexto CLS ANTES de continuar la cadena: todo el trabajo async del request
    // (guards, controller, services, loggers) hereda este correlationId sin pasarlo a mano.
    runWithRequestContext({ correlationId }, next);
  }
}
