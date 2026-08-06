/**
 * @file Filtro: traduce errores a un contrato HTTP controlado.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de filters sin introducir reglas de un dominio específico.
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { UniqueConstraintError, ValidationError } from 'sequelize';
import { normalizePostgresError, type NormalizedPostgresError } from '../database/postgres-error.js';

type HttpResponse = {
  status: (statusCode: number) => HttpResponse;
  json: (body: unknown) => void;
};

type HttpRequest = {
  method?: string;
  url?: string;
  correlationId?: string;
};

function buildErrorMessage(exception: unknown, postgres: NormalizedPostgresError | null): string {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return response;
    }

    if (typeof response === 'object' && response !== null && 'message' in response) {
      const responseMessage = (response as { message: unknown }).message;
      return Array.isArray(responseMessage) ? responseMessage.join(', ') : String(responseMessage);
    }
  }

  // El mensaje del catálogo SQLSTATE ya viene saneado (sin tabla, columna ni valores).
  if (postgres) {
    return postgres.clientMessage;
  }

  if (exception instanceof UniqueConstraintError) {
    return 'El recurso ya existe o viola una restricción única.';
  }

  if (exception instanceof ValidationError) {
    return 'La operación viola una restricción de datos.';
  }

  return 'Error interno no controlado.';
}

// El mensaje HTTP de los 5xx se sanea a propósito para el cliente, pero el log necesita la causa
// real. Los errores de Sequelize envuelven el error del driver en `original`/`parent` (p. ej. el
// mensaje de Postgres «no existe la columna X» y su código SQLSTATE), que suele ser lo único que
// delata la causa. El SQL no se registra: Sequelize inlinea valores en la consulta y podría
// filtrar datos sensibles al log.
function buildInternalCause(exception: unknown): string | null {
  if (!(exception instanceof Error)) {
    return exception === undefined || exception === null ? null : String(exception);
  }

  const original = (exception as { original?: unknown }).original ?? (exception as { parent?: unknown }).parent;
  const driverCode = original instanceof Error ? (original as { code?: unknown }).code : undefined;

  const parts: string[] = [];
  if (exception.message) {
    parts.push(exception.message);
  }
  if (original instanceof Error && original.message && original.message !== exception.message) {
    parts.push(original.message);
  }
  if (parts.length === 0) {
    return null;
  }

  const joined = parts.join(' — causa: ');
  return typeof driverCode === 'string' ? `${joined} [${driverCode}]` : joined;
}

type ValidationIssue = { path: string; message: string };

// El ZodValidationPipe adjunta `issues: [{path, message}]` al cuerpo de su BadRequestException. Se
// propagan al cliente SOLO en 400 (son mensajes de esquema, no PII) para que frontend/QA sepan qué
// campo falló, en vez del genérico "Entrada inválida en body.". No se exponen en 5xx.
function extractValidationIssues(exception: unknown): ValidationIssue[] | undefined {
  if (!(exception instanceof HttpException)) {
    return undefined;
  }
  const response = exception.getResponse();
  if (typeof response !== 'object' || response === null || !('issues' in response)) {
    return undefined;
  }
  const issues = (response as { issues: unknown }).issues;
  if (!Array.isArray(issues)) {
    return undefined;
  }
  return issues.filter(
    (issue): issue is ValidationIssue => typeof issue === 'object' && issue !== null && 'path' in issue && 'message' in issue,
  );
}

/**
 * La URL cruda incluye la query string, y en un backend KYC esos valores son PII
 * (`?identifier=...`, `?documentNumber=...`, `?email=...`). El log necesita saber QUÉ endpoint
 * falló y con qué filtros, no con qué valores, así que se conservan los NOMBRES de los parámetros y
 * se descartan sus valores. Hallazgo A-04 de `docs/audit/auditoria-integral-2026-07-30.md`.
 */
export function sanitizeUrlForLog(url: string | undefined): string {
  if (!url) return 'unknown';
  const separator = url.indexOf('?');
  if (separator === -1) return url;

  const path = url.slice(0, separator);
  const parameterNames = url
    .slice(separator + 1)
    .split('&')
    .map((pair) => pair.split('=')[0])
    .filter((name) => name.length > 0);

  return parameterNames.length > 0 ? `${path}?${parameterNames.join('&')}=[REDACTED]` : path;
}

function buildStatusCode(exception: unknown, postgres: NormalizedPostgresError | null): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }

  // Un SQLSTATE conocido es más preciso que el tipo de Sequelize: distingue 23503 (409) de 23502
  // (422) y cubre las consultas crudas, que no producen `UniqueConstraintError`.
  if (postgres) {
    return postgres.httpStatus;
  }

  if (exception instanceof UniqueConstraintError || exception instanceof ValidationError) {
    return HttpStatus.CONFLICT;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}

function buildErrorCode(statusCode: number): string {
  const codes: Record<number, string> = {
    400: 'VALIDATION_ERROR',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    410: 'GONE',
    413: 'PAYLOAD_TOO_LARGE',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'RATE_LIMIT_EXCEEDED',
    500: 'INTERNAL_ERROR',
    503: 'SERVICE_UNAVAILABLE',
    504: 'GATEWAY_TIMEOUT',
  };
  return codes[statusCode] ?? 'INTERNAL_ERROR';
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<HttpResponse>();
    const request = context.getRequest<HttpRequest>();
    // Se normaliza una sola vez y se comparte: el estado, el mensaje y el log deben coincidir.
    const postgres = exception instanceof HttpException ? null : normalizePostgresError(exception);
    const statusCode = buildStatusCode(exception, postgres);
    const message = buildErrorMessage(exception, postgres);
    const correlationId = request.correlationId;

    const safeUrl = sanitizeUrlForLog(request.url);

    // Un fallo de privilegios (42501) o una escritura por la conexión read-only (25006) son bugs de
    // aprovisionamiento/enrutamiento NUESTROS: el cliente ve un 5xx opaco, pero el log debe gritar
    // qué invariante se rompió, porque es justo lo que la separación read/write existe para cazar.
    if (postgres?.operatorFault) {
      this.logger.error(`[db:${postgres.kind}] SQLSTATE ${postgres.sqlState} — ${request.method} ${safeUrl} (${correlationId ?? 'no-id'})`);
    }

    if (statusCode >= 500) {
      const cause = buildInternalCause(exception);
      this.logger.error(
        `[${statusCode}] ${message}${cause && cause !== message ? ` — causa: ${cause}` : ''}`,
        exception instanceof Error ? exception.stack : undefined,
        JSON.stringify({ method: request.method, path: safeUrl, correlationId }),
      );
    } else if (statusCode >= 400) {
      this.logger.warn(`[${statusCode}] ${message} — ${request.method} ${safeUrl} (${correlationId ?? 'no-id'})`);
    }

    const issues = statusCode === HttpStatus.BAD_REQUEST ? extractValidationIssues(exception) : undefined;

    response.status(statusCode).json({
      requestId: correlationId,
      error: {
        code: buildErrorCode(statusCode),
        message,
        ...(issues && issues.length > 0 ? { issues } : {}),
      },
      timestamp: new Date().toISOString(),
    });
  }
}
