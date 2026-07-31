/**
 * @file Interceptor: aplica una política transversal al ciclo HTTP.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de interceptors sin introducir reglas de un dominio específico.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

type RequestWithCorrelationId = {
  correlationId?: string;
};

type ApiResponse<T> = {
  requestId: string | undefined;
  data: T;
  timestamp: string;
};

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<RequestWithCorrelationId>();
    return next.handle().pipe(
      map((data) => ({
        requestId: request.correlationId,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
