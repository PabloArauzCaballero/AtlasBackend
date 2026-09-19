---
title: "Observabilidad"
type: "architecture"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - observability
source_files:
  - "src/common/observability/metrics.service.ts"
  - "src/observability/tracing.ts"
aliases: []
related: []
---
# Observabilidad

Tres señales, con distinto grado de madurez.

| Señal | Estado | Herramienta |
|---|---|---|
| Métricas | Activo por defecto | `prom-client` → `/metrics` |
| Logs | Activo | `AppFileLogger` → archivo → sincronía a MongoDB |
| Trazas | **Opcional** (`OTEL_ENABLED`) | OpenTelemetry → OTLP HTTP |

## Correlación: el hilo conductor

`CorrelationIdMiddleware` asigna un id a **todo** request (`forRoutes('*')`). Ese id:

1. viaja en cada línea de log del request;
2. sale al cliente como `requestId` en la envoltura de respuesta;
3. ata la traza cuando OTel está activo.

> [!info] Por qué se devuelve al cliente
> Un usuario que reporta un fallo puede dar ese identificador y el operador encuentra exactamente ese request, sin buscar por hora aproximada y ruta. Ver [[09-observability/correlation-ids]].

## Métricas

`HttpMetricsInterceptor` es el interceptor **más externo**: mide la latencia total, incluyendo el resto de la cadena. No-op si `METRICS_ENABLED=false`.

| Familia | Contenido |
|---|---|
| HTTP | Peticiones, latencia y códigos por ruta (métricas RED) |
| Pool de BD | `db-pool-metrics.service.ts` — el techo real de escalado |
| Jobs | Ejecuciones registradas en `system_job_runs` |
| Proceso | Métricas por defecto de `prom-client` |

> [!info] Un timeout no desaparece de las series
> `RequestTimeoutInterceptor` va justo **dentro** de `HttpMetricsInterceptor`, a propósito: así el request cortado sí queda medido con su 503. Al revés, los requests más lentos —los que más importan— serían invisibles.

`/metrics` queda fuera del prefijo `/api/v1` por convención de Prometheus, y también lo expone la sonda del worker (3006).

## Trazas

Bootstrap importado **antes** que cualquier módulo instrumentable, en `main.ts` y `worker.ts`. Las auto-instrumentaciones envuelven HTTP, Express y `pg` al cargarlos: si un módulo instrumentable se carga primero, queda sin instrumentar.

`shutdownTracing()` se invoca en `SIGTERM`, `SIGINT` y en los handlers de `unhandledRejection`/`uncaughtException`, para no perder los spans del fallo que hay que investigar.

## Health

| Endpoint | Qué responde |
|---|---|
| `/health` | Estado + versión + commit + uptime. Nunca falla por sí mismo |
| `/health/liveness` | Trivial: si responde, el event loop atiende |
| `/health/readiness` | PostgreSQL (decide) + Redis (decide si configurado) + pool de lectura (**informativo**) |

Ver [[02-architecture/critical-sequences]] para las dos decisiones de diseño del readiness.

## Vacíos

`PENDIENTE`:

- **Sin SLO/SLI/SLA** definidos en el repositorio.
- **Sin definiciones de alerta** versionadas.
- **Sin dashboards** versionados.
- Trazas **desactivadas por defecto**: en producción hay que activarlas explícitamente.

## Relaciones

- [[09-observability/logging]] · [[09-observability/metrics]] · [[09-observability/correlation-ids]] · [[10-operations/runbooks/index]]
