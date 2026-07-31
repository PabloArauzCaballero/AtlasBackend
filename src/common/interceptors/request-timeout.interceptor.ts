/**
 * @file Interceptor: aplica una política transversal al ciclo HTTP.
 * @business Esta pieza evita que una petición atascada consuma recursos compartidos indefinidamente.
 * @system provee infraestructura transversal de interceptors sin introducir reglas de un dominio específico.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, RequestTimeoutException } from '@nestjs/common';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';
import { env } from '../../config/env.js';

/**
 * Techo de duración para cualquier petición HTTP.
 *
 * Hallazgo A-07 de `docs/audit/auditoria-integral-2026-07-30.md`: sin timeout global, un handler
 * colgado (una query sin índice sobre una tabla que creció, un proveedor externo que no responde y
 * cuyo timeout propio falló) retiene su conexión del pool indefinidamente. Con el pool agotado, la
 * degradación deja de ser local a ese endpoint y se lleva por delante a toda la API.
 *
 * Responde `503 REQUEST_TIMEOUT_EXCEEDED` — no `504`, porque el que no terminó a tiempo es este
 * servicio, no un upstream.
 *
 * `REQUEST_TIMEOUT_MS=0` lo desactiva. `/metrics` y los probes de salud quedan fuera: son endpoints
 * de infraestructura que un timeout propio solo puede empeorar (si el proceso está saturado, lo
 * último que conviene es dejar de reportarlo).
 */
const EXEMPT_PATH_PATTERN = /^\/(metrics|api\/v\d+\/health)/;

@Injectable()
export class RequestTimeoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const timeoutMs = env.REQUEST_TIMEOUT_MS;
    if (timeoutMs <= 0) return next.handle();

    const request = context.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
    const path = request.originalUrl ?? request.url ?? '';
    if (EXEMPT_PATH_PATTERN.test(path)) return next.handle();

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof TimeoutError
            ? new RequestTimeoutException(`REQUEST_TIMEOUT_EXCEEDED: la petición superó ${timeoutMs} ms.`)
            : error,
        ),
      ),
    );
  }
}
