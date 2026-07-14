import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { firstHeader } from '../../common/utils/http/headers.util.js';
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
    const hash = this.runtime.requestHash(request.body, request.query, request.params);

    return from(
      this.runtime.claimIdempotency({
        tenantScope: tenantScope(request),
        actorType: request.user?.role ?? null,
        actorId: actorId(request.user),
        idempotencyKey,
        scope,
        requestHash: hash,
        now: new Date(),
      }),
    ).pipe(
      mergeMap((claim) => {
        if (claim.mode === 'replay') {
          if (claim.responseStatus && typeof response.status === 'function') response.status(claim.responseStatus);
          return of(claim.responseBody);
        }

        return next.handle().pipe(
          // Antes se usaba `void this.runtime.completeIdempotency(...)`: la respuesta podía salir
          // como OK aunque la persistencia de idempotencia fallara. En backend fintech, una
          // mutación con X-Idempotency-Key debe quedar registrada antes de responder.
          mergeMap((body) =>
            from(this.runtime.completeIdempotency(claim.record, response.statusCode ?? 200, body)).pipe(mergeMap(() => of(body))),
          ),
          catchError((error: unknown) =>
            from(this.runtime.failIdempotency(claim.record)).pipe(
              catchError(() => of(undefined)),
              mergeMap(() => throwError(() => error)),
            ),
          ),
        );
      }),
    );
  }
}
