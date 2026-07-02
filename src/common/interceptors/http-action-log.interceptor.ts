import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { AuthenticatedUser } from '../types/auth.types.js';
import { HttpActionLogService } from '../../modules/audit/http-action-log.service.js';

type RequestLike = {
  method: string;
  originalUrl?: string;
  path?: string;
  url?: string;
  params?: Record<string, string>;
  query?: unknown;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  user?: AuthenticatedUser;
  correlationId?: string;
};

type ResponseLike = { statusCode?: number };

function firstHeader(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function cleanPath(path: string): string {
  return path.split('?')[0] ?? path;
}

function actionCode(method: string, path: string): string {
  const normalizedPath = cleanPath(path)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  return `http.${method.toLowerCase()}.${normalizedPath || 'root'}`.slice(0, 120);
}

function targetId(request: RequestLike): string | null {
  return (
    request.params?.customerId ??
    request.params?.caseId ??
    request.params?.sessionId ??
    request.params?.id ??
    request.user?.customerId ??
    request.user?.internalUserId ??
    request.user?.platformUserId ??
    request.user?.sub ??
    null
  );
}

function clientIp(request: RequestLike): string | null {
  return firstHeader(request.headers['x-forwarded-for'])?.split(',')[0]?.trim() ?? request.ip ?? null;
}

@Injectable()
export class HttpActionLogInterceptor implements NestInterceptor {
  constructor(private readonly actionLog: HttpActionLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const response = context.switchToHttp().getResponse<ResponseLike>();
    const startedAt = Date.now();
    const path = request.originalUrl ?? request.url ?? request.path ?? 'unknown';

    const baseLog = (statusCode: number, outcome: 'success' | 'error', errorMessage?: string) =>
      this.actionLog.createHttpAction({
        tenantId: request.user?.tenantId ?? firstHeader(request.headers['x-tenant-id']),
        actorType: request.user?.role ?? 'public_or_unknown',
        actorInternalUserId: request.user?.internalUserId ?? null,
        actorPlatformUserId: request.user?.platformUserId ?? null,
        actionCode: actionCode(request.method, path),
        targetType: 'http_endpoint',
        targetId: targetId(request),
        ipAddress: clientIp(request),
        userAgent: firstHeader(request.headers['user-agent']),
        occurredAt: new Date(),
        payload: {
          method: request.method,
          path: cleanPath(path),
          query: request.query,
          statusCode,
          outcome,
          durationMs: Date.now() - startedAt,
          correlationId: request.correlationId ?? null,
          ...(errorMessage ? { errorMessage } : {}),
        },
      });

    return next.handle().pipe(
      mergeMap((body) => from(baseLog(response.statusCode ?? 200, 'success')).pipe(mergeMap(() => of(body)))),
      catchError((error: unknown) => {
        const statusCode =
          error instanceof HttpException
            ? error.getStatus()
            : response.statusCode && response.statusCode >= 400
              ? response.statusCode
              : 500;
        return from(baseLog(statusCode, 'error', error instanceof Error ? error.message : 'unknown_error')).pipe(
          catchError(() => of(undefined)),
          mergeMap(() => throwError(() => error)),
        );
      }),
    );
  }
}
