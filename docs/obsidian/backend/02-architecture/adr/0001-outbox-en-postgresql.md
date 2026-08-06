---
title: "ADR — Outbox transaccional en PostgreSQL (no cola dedicada)"
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
# Outbox transaccional en PostgreSQL (no cola dedicada)

> [!info] Documento canónico
> El ADR completo vive en [`docs/adr/0001-outbox-en-postgresql.md`](../../../adr/0001-outbox-en-postgresql.md). Esta nota lo resume y lo enlaza con el resto de la bóveda; **ante discrepancia, prevalece el canónico**.

| | |
|---|---|
| Estado | Aceptado |
| Fecha | 2026-07-16 |
| Decisores | equipo backend |

## Contexto

Publicar eventos de dominio con garantía *at-least-once* sin perder ninguno si el proceso muere entre el commit de negocio y la publicación.

## Decisión

El outbox vive en una tabla de PostgreSQL (`outbox_events`), escrita en la misma transacción que el cambio de negocio y drenada por un despachador. **No** se introduce broker dedicado.

## Alternativas consideradas

**SQS / broker gestionado** — añade una dependencia de infraestructura, coste fijo y un segundo sistema con su propia semántica de fallo y observabilidad, para un volumen que hoy PostgreSQL absorbe. La atomicidad "negocio + evento" seguiría exigiendo un outbox de todos modos.

## Consecuencias

Latencia de publicación acotada por el intervalo del job; carga adicional sobre PostgreSQL; sin orden garantizado entre agregados.

## Relaciones

- [[07-async-processing/events]]
- [[07-async-processing/queues]]
- [[outbox_events]]
