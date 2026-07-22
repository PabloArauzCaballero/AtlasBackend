import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { UniqueConstraintError, ValidationError } from 'sequelize';

type HttpResponse = {
  status: (statusCode: number) => HttpResponse;
  json: (body: unknown) => void;
};

type HttpRequest = {
  method?: string;
  url?: string;
  correlationId?: string;
};

function buildErrorMessage(exception: unknown): string {
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

function buildStatusCode(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
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
    const statusCode = buildStatusCode(exception);
    const message = buildErrorMessage(exception);
    const correlationId = request.correlationId;

    if (statusCode >= 500) {
      const cause = buildInternalCause(exception);
      this.logger.error(
        `[${statusCode}] ${message}${cause && cause !== message ? ` — causa: ${cause}` : ''}`,
        exception instanceof Error ? exception.stack : undefined,
        JSON.stringify({ method: request.method, path: request.url, correlationId }),
      );
    } else if (statusCode >= 400) {
      this.logger.warn(`[${statusCode}] ${message} — ${request.method} ${request.url} (${correlationId ?? 'no-id'})`);
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
