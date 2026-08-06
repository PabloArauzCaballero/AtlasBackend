---
title: "ADR — Sincronía de logs a MongoDB como visor operativo opcional"
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
# Sincronía de logs a MongoDB como visor operativo opcional

> [!info] Documento canónico
> El ADR completo vive en [`docs/adr/0003-mongo-log-sync.md`](../../../adr/0003-mongo-log-sync.md). Esta nota lo resume y lo enlaza con el resto de la bóveda; **ante discrepancia, prevalece el canónico**.

| | |
|---|---|
| Estado | Aceptado |
| Fecha | 2026-07-16 |
| Decisores | equipo backend |

## Contexto

El backend escribe un log de archivo; `log-sync` lo sigue y lo sincroniza a MongoDB, donde se expone un visor consultable. La auditoría cuestionó la duplicación archivo → Mongo frente a los pipelines nativos de plataforma.

## Decisión

Se **conserva** como visor operativo propio y **opcional**: apagado por defecto (sin `MONGO_DB_URL_CONNECTION` no se activa), desacoplado del arranque, y **secundario** — la fuente primaria sigue siendo el log de aplicación que consume la plataforma.

## Alternativas consideradas

**Retirar Mongo** y apoyarse solo en el pipeline de la plataforma (CloudWatch, Loki, OpenSearch).

## Consecuencias

Una conexión y un almacén más que operar, a cambio de un visor propio que no depende del proveedor.

## Relaciones

- [[09-observability/logging]]
- [[05-data/data-stores]]
- [[03-domains/log-sync/index]]
