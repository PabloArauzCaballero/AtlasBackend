import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { UniqueConstraintError, ValidationError } from 'sequelize';

type HttpResponse = {
  status: (statusCode: number) => HttpResponse;
  json: (body: unknown) => void;
};

type HttpRequest = {
  method?: string;
  url?: string;
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

function buildStatusCode(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }

  if (exception instanceof UniqueConstraintError || exception instanceof ValidationError) {
    return HttpStatus.CONFLICT;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
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

    if (statusCode >= 500) {
      this.logger.error(message, exception instanceof Error ? exception.stack : undefined);
    }

    response.status(statusCode).json({
      success: false,
      error: {
        statusCode,
        message,
      },
      request: {
        method: request.method,
        path: request.url,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
