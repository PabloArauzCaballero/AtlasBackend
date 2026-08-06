---
title: "ADR — Redis obligatorio solo en producción"
type: "adr"
status: "verified"
owner: "@PabloArauzCaballero"
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
# Redis obligatorio solo en producción

> [!info] Documento canónico
> El ADR completo vive en [`docs/adr/0002-redis-solo-en-produccion.md`](../../../adr/0002-redis-solo-en-produccion.md). Esta nota lo resume y lo enlaza con el resto de la bóveda; **ante discrepancia, prevalece el canónico**.

| | |
|---|---|
| Estado | Aceptado |
| Fecha | 2026-07-16 |
| Decisores | equipo backend |

## Contexto

Redis sostiene el rate limiting distribuido, la caché y el liderazgo de jobs, pero exigirlo en desarrollo encarece el arranque local.

## Decisión

Redis es **opcional en desarrollo y test** (el cliente es `null`) y **obligatorio en producción**, donde Zod lo exige por validación cruzada.

## Alternativas consideradas

Exigirlo siempre — arranque local más pesado. No exigirlo nunca — el rate limit se contaría por instancia en producción.

## Consecuencias

El comportamiento del rate limit **difiere entre local y producción**: sin Redis cada instancia cuenta por su lado.

## Relaciones

- [[05-data/data-stores]]
- [[04-api/rate-limits]]
- [[10-operations/environments]]
