/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de observability sin introducir reglas de un dominio específico.
 */
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
