---
title: "ADR — Paginación por cursor como camino por defecto de alto volumen"
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
# Paginación por cursor como camino por defecto de alto volumen

> [!info] Documento canónico
> El ADR completo vive en [`docs/adr/0005-paginacion-por-cursor.md`](../../../adr/0005-paginacion-por-cursor.md). Esta nota lo resume y lo enlaza con el resto de la bóveda; **ante discrepancia, prevalece el canónico**.

| | |
|---|---|
| Estado | Aceptado |
| Fecha | 2026-07-16 |
| Decisores | equipo backend |

## Contexto

`OFFSET N` obliga a recorrer y descartar N filas, y un `count` exacto sobre tablas grandes es caro. Además la paginación es inestable bajo escritura concurrente.

## Decisión

El cursor (*keyset*) es el camino por defecto para **listados de alto volumen** (`audit`, `events`, `operations`, `data-quality`). El cursor opaco codifica una posición estable, avanza en O(1) por página y puede devolver resultados **sin total exacto**. `OFFSET` se conserva **solo** para pantallas administrativas pequeñas y acotadas.

## Alternativas consideradas

**OFFSET en todo** — no escala. **Cursor en todo** — sin total exacto empeora la experiencia en pantallas admin pequeñas.

## Consecuencias

Dos estrategias conviven; hay que elegir la correcta por endpoint.

## Relaciones

- [[04-api/pagination-filtering-sorting]]
- [[04-api/conventions]]
