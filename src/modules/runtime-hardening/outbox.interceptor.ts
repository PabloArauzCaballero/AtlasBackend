import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, mergeMap, of } from 'rxjs';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
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

function firstHeader(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

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
        const tenantId = request.user?.tenantId ?? firstHeader(request.headers['x-tenant-id']);
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
