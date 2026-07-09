import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { AuthenticatedUser } from '../types/auth.types.js';
import { HttpActionLogService } from '../../modules/audit/http-action-log.service.js';
import { moduleFromPath } from '../../modules/systems-ops/endpoint-code.util.js';

type RequestLike = {
  method: string;
  originalUrl?: string;
  path?: string;
  url?: string;
  params?: Record<string, string>;
  query?: unknown;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  user?: AuthenticatedUser;
  correlationId?: string;
  route?: { path?: string };
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

function isLikelyPiiPath(path: string): boolean {
  return /customer|identity|contact|consent|privacy|session|auth|telemetry|notification|external-data/i.test(path);
}

function idempotencyKey(request: RequestLike): string | null {
  return firstHeader(request.headers['x-idempotency-key']);
}

@Injectable()
export class HttpActionLogInterceptor implements NestInterceptor {
  constructor(private readonly actionLog: HttpActionLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const response = context.switchToHttp().getResponse<ResponseLike>();
    const startedAt = Date.now();
    const path = cleanPath(request.originalUrl ?? request.url ?? request.path ?? 'unknown');
    const requestId = firstHeader(request.headers['x-request-id']) ?? request.correlationId ?? randomUUID();

    const baseLog = (statusCode: number, outcome: 'success' | 'error', errorMessage?: string) =>
      this.actionLog.createHttpAction({
        tenantId: request.user?.tenantId ?? firstHeader(request.headers['x-tenant-id']),
        actorType: request.user?.role ?? 'public_or_unknown',
        actorRole: request.user?.role ?? 'public_or_unknown',
        actorUserId: request.user?.sub ?? null,
        actorInternalUserId: request.user?.internalUserId ?? null,
        actorPlatformUserId: request.user?.platformUserId ?? null,
        actionCode: actionCode(request.method, path),
        targetType: 'http_endpoint',
        targetId: targetId(request),
        ipAddress: clientIp(request),
        userAgent: firstHeader(request.headers['user-agent']),
        occurredAt: new Date(),
        requestId,
        correlationId: request.correlationId ?? requestId,
        method: request.method,
        routeTemplate: request.route?.path ?? null,
        resolvedUrlSanitized: path,
        module: moduleFromPath(path),
        actionName: actionCode(request.method, path),
        responseStatusCode: statusCode,
        durationMs: Date.now() - startedAt,
        idempotencyKey: idempotencyKey(request),
        riskLevel: statusCode >= 500 ? 'HIGH' : isLikelyPiiPath(path) ? 'MEDIUM' : 'LOW',
        containsPii: isLikelyPiiPath(path),
        errorCode: outcome === 'error' ? 'HTTP_REQUEST_ERROR' : null,
        errorMessage: errorMessage ?? null,
        payload: {
          method: request.method,
          path,
          query: request.query,
          body: request.body,
          params: request.params,
          statusCode,
          outcome,
          durationMs: Date.now() - startedAt,
          correlationId: request.correlationId ?? null,
          requestId,
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
