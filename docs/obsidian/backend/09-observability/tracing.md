---
title: "Trazas"
type: "architecture"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - observability
aliases: []
related: []
---
# Trazas

## Estado: opcional

OpenTelemetry está integrado pero **desactivado por defecto**. Se activa con `OTEL_ENABLED=true`; sin él, el bootstrap es no-op.

| Pieza | Librería |
|---|---|
| SDK | `@opentelemetry/sdk-node` |
| Instrumentación | `@opentelemetry/auto-instrumentations-node` (HTTP, Express, `pg`) |
| Exportador | `@opentelemetry/exporter-trace-otlp-http` |

## El orden del import es el detalle crítico

```ts
import 'reflect-metadata';
import './observability/tracing-bootstrap.js';   // ANTES que cualquier módulo instrumentable
import { NestFactory } from '@nestjs/core';
```

> [!warning] Si se mueve ese import, las trazas quedan vacías sin dar error
> Las auto-instrumentaciones envuelven HTTP, Express y `pg` **en el momento de cargarlos**. Si un módulo instrumentable se carga primero, queda sin envolver — y el fallo es silencioso: el SDK arranca, exporta, y no aparece nada.

El comentario del código lo advierte en ambos entrypoints.

## Cierre

`shutdownTracing()` se invoca en `SIGTERM`, `SIGINT` y en los handlers de `unhandledRejection`/`uncaughtException` — precisamente para no perder los spans del fallo que hay que investigar.

## Correlación

Cuando está activo, el `correlationId` ata la traza con los logs y con el `requestId` devuelto al cliente. Ver [[09-observability/correlation-ids]].

## Recomendación

`PENDIENTE` — activarlo en producción. El coste es el exportador y el colector; el beneficio, ver la latencia repartida entre capas en vez de deducirla de métricas agregadas. Especialmente útil para el pool de conexiones, donde el tiempo se va **esperando**, no ejecutando.

## Relaciones

- [[09-observability/observability-overview]] · [[09-observability/correlation-ids]]
