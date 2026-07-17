import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service.js';
import { readObservabilityConfig } from './observability.config.js';

type ExpressLikeRequest = {
  method?: string;
  route?: { path?: string };
  originalUrl?: string;
};

type ExpressLikeResponse = {
  statusCode?: number;
};

/**
 * Interceptor global que mide cada request HTTP y alimenta `MetricsService` (Fase 3.4). Usa el
 * PATRÓN de ruta (`/api/v1/users/:id`), no la URL con valores, para no explotar la cardinalidad de
 * las series. Si las métricas están apagadas (`METRICS_ENABLED=false`), es un passthrough sin costo.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  private readonly enabled = readObservabilityConfig().metricsEnabled;

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled || context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<ExpressLikeRequest>();
    const response = http.getResponse<ExpressLikeResponse>();
    const method = (request.method ?? 'UNKNOWN').toUpperCase();
    const start = process.hrtime.bigint();

    const record = (statusCode: number): void => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.observeHttpRequest({ method, route: this.routeOf(request), statusCode, durationSeconds });
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode ?? 200),
        error: (error: unknown) => record(error instanceof HttpException ? error.getStatus() : 500),
      }),
    );
  }

  /** Ruta de baja cardinalidad: el patrón matcheado por Express (`req.route.path`), no la URL cruda. */
  private routeOf(request: ExpressLikeRequest): string {
    return request.route?.path ?? 'unmatched';
  }
}
