/**
 * @file Interceptor: aplica una política transversal al ciclo HTTP.
 * @business Esta pieza evita duplicados y pérdida de efectos ante reintentos, concurrencia o fallos parciales.
 * @system centraliza idempotencia y outbox como garantías transversales del runtime HTTP.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, ReplaySubject, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { firstHeader } from '../../common/utils/http/headers.util.js';
import { committedResultOf } from './application/committed-result.js';
import { RuntimeHardeningService } from './runtime-hardening.service.js';

type RequestLike = {
  method: string;
  originalUrl?: string;
  path?: string;
  body?: unknown;
  query?: unknown;
  params?: unknown;
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
  correlationId?: string;
};

type ResponseLike = { statusCode?: number; status?: (statusCode: number) => ResponseLike };

function tenantScope(request: RequestLike): string {
  return request.user?.tenantId ?? firstHeader(request.headers['x-tenant-id']) ?? 'global';
}

function actorId(user: AuthenticatedUser | undefined): string | null {
  return user?.customerId ?? user?.internalUserId ?? user?.platformUserId ?? user?.sub ?? null;
}

function shouldHandle(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly runtime: RuntimeHardeningService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    if (!shouldHandle(request.method)) return next.handle();

    const idempotencyKey = firstHeader(request.headers['x-idempotency-key']);
    if (!idempotencyKey) return next.handle();

    const response = context.switchToHttp().getResponse<ResponseLike>();
    const scope = `${request.method.toUpperCase()} ${request.originalUrl ?? request.path ?? 'unknown'}`;

    return from(
      this.runtime.claimIdempotency({
        tenantScope: tenantScope(request),
        actorType: request.user?.role ?? null,
        actorId: actorId(request.user),
        idempotencyKey,
        scope,
        // La huella la calcula el servicio (política versionada, AT-010); aquí sólo viaja la petición.
        request: { body: request.body, query: request.query, params: request.params },
        now: new Date(),
      }),
    ).pipe(
      mergeMap((claim) => {
        if (claim.mode === 'replay') {
          if (claim.responseStatus && typeof response.status === 'function') response.status(claim.responseStatus);
          return of(claim.responseBody);
        }

        const settled = next.handle().pipe(
          // El `catchError` va ANTES del cierre: sólo un fallo del handler libera la clave. Si fallara
          // `completeIdempotency` y cayera aquí, la clave quedaba `failed` con la mutación ya hecha, y
          // el reintento la ejecutaba otra vez. Un error marcado como posterior al commit (el outbox)
          // tampoco la libera: se guarda el cuerpo que devolvió el handler.
          catchError((error: unknown) => {
            const committed = committedResultOf(error);
            const settle = committed
              ? this.runtime.completeIdempotency(claim.lease, response.statusCode ?? 200, committed.body)
              : this.runtime.failIdempotency(claim.lease);
            return from(settle).pipe(
              catchError(() => of(undefined)),
              mergeMap(() => throwError(() => error)),
            );
          }),
          // Antes se usaba `void this.runtime.completeIdempotency(...)`: la respuesta podía salir
          // como OK aunque la persistencia de idempotencia fallara. En backend fintech, una
          // mutación con X-Idempotency-Key debe quedar registrada antes de responder.
          mergeMap((body) =>
            from(this.runtime.completeIdempotency(claim.lease, response.statusCode ?? 200, body)).pipe(mergeMap(() => of(body))),
          ),
        );
        // La ejecución se suscribe aparte y no depende de quien espera la respuesta. El timeout
        // global (`RequestTimeoutInterceptor`) va por fuera y, al vencer, se desuscribe; el handler
        // (una promesa) sigue y hace commit, pero el cierre de la clave se perdía con la suscripción:
        // quedaba `processing` y al vencer el lease el reintento volvía a ejecutar la mutación. Así
        // el resultado se registra igual aunque el cliente ya recibiera el 408.
        const result = new ReplaySubject<unknown>();
        settled.subscribe(result);
        return result.asObservable();
      }),
    );
  }
}
