/**
 * @file Interceptor: aplica una política transversal al ciclo HTTP.
 * @business Esta pieza evita duplicados y pérdida de efectos ante reintentos, concurrencia o fallos parciales.
 * @system centraliza idempotencia y outbox como garantías transversales del runtime HTTP.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, mergeMap, of } from 'rxjs';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { firstHeader } from '../../common/utils/http/headers.util.js';
import { RuntimeHardeningService } from './runtime-hardening.service.js';

type RequestLike = {
  method: string;
  originalUrl?: string;
  path?: string;
  params?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
  correlationId?: string;
};

function shouldHandle(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

@Injectable()
export class ApiCommandOutboxInterceptor implements NestInterceptor {
  constructor(private readonly runtime: RuntimeHardeningService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    if (!shouldHandle(request.method)) return next.handle();

    return next.handle().pipe(
      mergeMap((body) => {
        const tenantId = request.user?.tenantId ?? tenantFromHeader(request.headers['x-tenant-id']);
        // Antes era fire-and-forget con `void`: si fallaba la escritura del outbox, el cliente
        // recibía OK pero el sistema perdía trazabilidad/eventual processing. Ahora se espera la
        // persistencia del evento antes de devolver la respuesta de mutación.
        return from(
          this.runtime.emitApiCommandCompleted({
            tenantId,
            aggregateType: 'api_command',
            aggregateId: request.params?.customerId ?? request.params?.caseId ?? request.params?.sessionId ?? null,
            eventCode: `${request.method.toLowerCase()}_${(request.originalUrl ?? request.path ?? 'unknown').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}_completed`,
            payload: {
              method: request.method,
              path: request.originalUrl ?? request.path,
              actorRole: request.user?.role ?? 'public_or_unknown',
              resultType: body && typeof body === 'object' ? 'object' : typeof body,
            },
            correlationId: request.correlationId ?? null,
          }),
        ).pipe(mergeMap(() => of(body)));
      }),
    );
  }
}

/**
 * El inquilino declarado en la cabecera, SÓLO si puede ser un inquilino.
 *
 * En una ruta `@Public` no hay usuario y `TenantGuard` deja pasar la cabecera sin validarla, y aquí se
 * usaba tal cual. `_tenant_id` es BIGINT: con `x-tenant-id: abc` PostgreSQL rechaza el INSERT, y como
 * este interceptor espera a que el evento se escriba ANTES de responder, la petición acaba en 500 aunque
 * el manejador ya haya hecho su trabajo —en `auth/refresh`, con la sesión ya rotada—.
 *
 * Lo que no parece un id se trata como «sin inquilino», que desde `f263d37` recoge el consumidor. Un id
 * numérico que no existe (`999`) sigue sin validarse: comprobarlo costaría una consulta por mutación, y
 * medido en el servidor el 2026-09-10 no hay ningún evento así.
 */
function tenantFromHeader(value: string | string[] | undefined): string | null {
  const declarado = firstHeader(value);
  return declarado && /^[0-9]{1,18}$/.test(declarado) ? declarado : null;
}
