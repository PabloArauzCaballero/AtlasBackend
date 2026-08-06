---
title: "Métricas"
type: "architecture"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - observability
  - metrics
aliases: []
related: []
---
# Métricas

## Exposición

`prom-client` sobre `/metrics`, fuera del prefijo `/api/v1`. También en la sonda del worker (`WORKER_PROBE_PORT`, 3006). Activable con `METRICS_ENABLED`.

## Qué se mide

| Familia | Fuente | Uso |
|---|---|---|
| HTTP (RED) | `HttpMetricsInterceptor` | Tasa, errores y latencia por ruta |
| Pool de BD | `DbPoolMetricsService` | Saturación de conexiones — el techo real de escalado |
| Proceso | `prom-client` | CPU, memoria, event loop, GC |
| Jobs | `system_job_runs` (en BD, no en Prometheus) | Última ejecución y resultado |

## Las dos métricas que más dicen

1. **Saturación del pool.** Si se agota, la latencia se dispara sin que ninguna consulta sea lenta. Es el primer sitio donde mirar ante un "todo va lento" sin causa aparente. Recordar el límite: (réplicas × `DB_POOL_MAX`) ≤ `CONNECTION LIMIT` del rol.
2. **Latencia por ruta con sus 503.** Como `RequestTimeoutInterceptor` va dentro del interceptor de métricas, los requests cortados por timeout **sí** aparecen. Un pico de 503 en una ruta concreta apunta a esa dependencia, no a una caída general.

## Seguridad del endpoint

> [!warning] Sin autenticación de aplicación
> `/metrics` no pasa por `JwtAuthGuard`. Expone nombres de ruta, códigos y latencias. Debe ir tras red aislada y con `@SkipThrottle` (el scrape es periódico y legítimo). Ver [[14-audits/risks-register|SEC-004]].

## Vacíos

`PENDIENTE` — no hay reglas de alerta ni dashboards versionados en el repositorio, así que no se puede documentar qué se vigila hoy ni con qué umbrales.

## Relaciones

- [[09-observability/observability-overview]] · [[09-observability/alerts]] · [[10-operations/runbooks/index]]
