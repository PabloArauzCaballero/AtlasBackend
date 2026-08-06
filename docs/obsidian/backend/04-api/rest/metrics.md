---
title: "API — metrics"
type: "api"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "api"
  - "observability"
source_files:
  - "src/common/observability/metrics.controller.ts"
aliases: []
related: []
---
# API — `/metrics`

| Método | Ruta | Auth | Prefijo |
|---|---|---|---|
| `GET` | `/metrics` | **ninguna** | Excluido de `/api/v1` |

## Fuera del prefijo, a propósito

`main.ts:72` excluye `metrics` del prefijo global:

```ts
app.setGlobalPrefix(env.API_PREFIX, { exclude: ['metrics'] });
```

Es la convención de *scrape* de Prometheus. Por eso el catálogo de rutas del código tiene **266** entradas y el contrato OpenAPI **265**: esta no forma parte del contrato de negocio.

También lo expone la sonda del worker en `WORKER_PROBE_PORT` (3006).

> [!danger] Sin autenticación de aplicación
> No pasa por `JwtAuthGuard`. Expone nombres de ruta, códigos de estado y latencias — información útil para perfilar el sistema.
>
> La regla del proyecto exige red aislada y `@SkipThrottle` para endpoints de infraestructura, pero **esa condición se decide en el despliegue y no es verificable desde el código**. Ver [[14-audits/risks-register|SEC-004]].

## Contenido

Métricas RED por ruta, del pool de base de datos y del proceso. Activable con `METRICS_ENABLED`. Ver [[09-observability/metrics]].

## Relaciones

- [[09-observability/observability-overview]] · [[15-reference/ports]] · [[02-architecture/trust-boundaries]]
