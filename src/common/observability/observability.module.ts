/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de observability sin introducir reglas de un dominio específico.
 */
import { Global, Module } from '@nestjs/common';
import { MessagingTraceService } from './messaging-trace.service.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';
import { TraceContextService } from './trace-context.service.js';
import { TracingService } from './tracing.service.js';

/**
 * Los dos ejes de observabilidad de este backend:
 *
 * - **Métricas** (`prom-client`): registro y endpoint de scrape. Responden «cuánto» y «con qué
 *   frecuencia», agregado.
 * - **Trazas** (OpenTelemetry): `TracingService`, `TraceContextService` y `MessagingTraceService`.
 *   Responden «qué pasó en ESTA petición», caso por caso.
 *
 * Es `@Global` por la misma razón por la que lo era para las métricas: un dominio no debería
 * tener que importar un módulo para poder instrumentarse, porque el que no lo importa es
 * justamente el que se queda sin observabilidad.
 *
 * El ARRANQUE del SDK vive fuera del contenedor de Nest, en `src/observability/tracing.ts`,
 * porque debe ocurrir antes de que se cargue cualquier módulo instrumentable. Aquí sólo viven
 * las piezas que el dominio inyecta.
 *
 * Los interceptores globales (`TraceResponseInterceptor`) se registran en `app.module.ts`, no
 * aquí: su ORDEN respecto de los demás importa y sólo es determinista en un único sitio.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, TracingService, TraceContextService, MessagingTraceService],
  exports: [MetricsService, TracingService, TraceContextService, MessagingTraceService],
})
export class ObservabilityModule {}
