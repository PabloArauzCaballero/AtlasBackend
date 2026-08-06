---
title: "ADR — Separación de roles API y worker"
type: "adr"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - architecture
  - adr
aliases: []
related: []
---
# Separación de roles API y worker

> [!info] Documento canónico
> El ADR completo vive en [`docs/adr/0006-separacion-de-roles-api-worker.md`](../../../adr/0006-separacion-de-roles-api-worker.md). Esta nota lo resume y lo enlaza con el resto de la bóveda; **ante discrepancia, prevalece el canónico**.

| | |
|---|---|
| Estado | Aceptado |
| Fecha | 2026-07-16 |
| Decisores | equipo backend |

## Contexto

El trabajo de fondo competía con la latencia del request en el mismo proceso.

## Decisión

Un mismo artefacto con dos entrypoints y la variable `APP_ROLE` (`api` | `worker` | `all`). Cada entrypoint **falla al arrancar** si el rol no le corresponde.

## Alternativas consideradas

Dos artefactos separados — duplicaría el despliegue y el riesgo de divergencia.

## Consecuencias

Se escala por proceso, no por dominio; ambos comparten la misma imagen y el mismo `AppModule`.

## Relaciones

- [[02-architecture/runtime-topology]]
- [[07-async-processing/workers]]
