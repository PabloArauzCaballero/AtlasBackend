import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

/**
 * Módulo de observabilidad (Fase 3.4 del plan 10/10): registro de métricas Prometheus y su endpoint
 * de scrape. Es `@Global` para que `MetricsService` esté disponible al `HttpMetricsInterceptor`
 * registrado en `AppModule` sin re-importar el módulo. La instrumentación de trazas (OpenTelemetry)
 * vive fuera del contenedor de Nest, en `src/observability/tracing.ts`, porque debe arrancar antes.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
