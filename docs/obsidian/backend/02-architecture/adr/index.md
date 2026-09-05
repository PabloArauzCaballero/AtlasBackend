---
title: "Decisiones de arquitectura (ADR)"
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
# Decisiones de arquitectura (ADR)

Los ADR canónicos viven en [`docs/adr/`](../../../../adr/). Estas notas los resumen y los enlazan con el resto de la bóveda.

| ADR | Decisión | Estado |
|---|---|---|
| [[02-architecture/adr/0001-outbox-en-postgresql\|0001]] | Outbox transaccional en PostgreSQL (no cola dedicada) | Aceptado |
| [[02-architecture/adr/0002-redis-solo-en-produccion\|0002]] | Redis obligatorio solo en producción | Aceptado |
| [[02-architecture/adr/0003-mongo-log-sync\|0003]] | Sincronía de logs a MongoDB como visor operativo opcional | Aceptado |
| [[02-architecture/adr/0004-kms-envelope-encryption\|0004]] | Envelope encryption con KMS para PII | Aceptado |
| [[02-architecture/adr/0005-paginacion-por-cursor\|0005]] | Paginación por cursor como camino por defecto de alto volumen | Aceptado |
| [[02-architecture/adr/0006-separacion-de-roles-api-worker\|0006]] | Separación de roles API y worker | Aceptado |
| [[02-architecture/adr/0007-contrato-openapi-enriquecido\|0007]] | El contrato OpenAPI se completa por transformación, no por anotación repetida | Aceptado |

## Decisiones sin ADR

> [!warning] Dos decisiones estructurales no están documentadas como ADR
> 1. **La separación en 12 esquemas de dominio.** Determina el acoplamiento físico entre dominios (153 FK cruzadas) y condiciona cualquier extracción futura.
> 2. **El patrón de tres columnas para PII** (hash + cifrado + fragmento). Afecta a cómo se busca y se muestra todo dato sensible.
>
> Ambas se infieren del código, y su *porqué* vive en comentarios dispersos. Cuando alguien proponga cambiarlas no habrá un documento que enumere las alternativas descartadas. Ver [[02-architecture/architecture-risks]].

## Plantilla

Para un ADR nuevo: [`docs/adr/_template.md`](../../../../adr/_template.md) o [[templates/adr-template]].

## Relaciones

- [[02-architecture/architecture-overview]] · [[02-architecture/architectural-style]]
