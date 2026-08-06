---
title: "ADR — El contrato OpenAPI se completa por transformación, no por anotación repetida"
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
# El contrato OpenAPI se completa por transformación, no por anotación repetida

> [!info] Documento canónico
> El ADR completo vive en [`docs/adr/0007-contrato-openapi-enriquecido.md`](../../../adr/0007-contrato-openapi-enriquecido.md). Esta nota lo resume y lo enlaza con el resto de la bóveda; **ante discrepancia, prevalece el canónico**.

| | |
|---|---|
| Estado | Aceptado |
| Fecha | 2026-07-31 |
| Decisores | equipo backend |

## Contexto

Medido el 2026-07-31: de 263 operaciones, **252 respuestas 2xx no tenían ningún esquema**, `components.schemas` estaba vacío, 11 operaciones no declaraban `security` y no había `servers`. Un integrador no podía saber qué recibiría sin llamar al endpoint. Y sin embargo el 100 % de las respuestas comparte forma.

## Decisión

El contrato se completa en **una transformación del documento generado** (`enrich-document.ts`) en vez de repetir anotaciones en cada handler: la envoltura `{ requestId, data, timestamp }` y el error `{ requestId, error: { code, message, issues? }, timestamp }` se declaran **una vez**.

## Alternativas consideradas

Anotar cada operación a mano — 263 puntos donde olvidarlo.

## Consecuencias

El contrato publicado depende de una transformación: hay que mantenerla al cambiar la forma de la envoltura.

## Relaciones

- [[04-api/error-model]]
- [[04-api/conventions]]
- [[04-api/versioning]]
