---
title: "Plantillas"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "low"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - template
aliases: []
related: []
---

# Plantillas

Estructuras estables para añadir notas sin reinventar el formato.

| Plantilla | Para |
|---|---|
| [[templates/module-template]] | Un módulo de negocio nuevo |
| [[templates/endpoint-template]] | Un endpoint que merezca nota propia |
| [[templates/data-entity-template]] | Referencia de la estructura de las notas de entidad |
| [[templates/integration-template]] | Un proveedor externo nuevo |
| [[templates/runbook-template]] | Un incidente operativo |
| [[templates/adr-template]] | Una decisión de arquitectura |

## Notas generadas frente a notas escritas

> [!warning] Algunas notas se regeneran y perderían tus ediciones
> Se **generan** por análisis estático: las 130 de `05-data/entities/`, las de `04-api/rest/`, las 12 de `05-data/domains/`, las de `03-domains/*/index.md` y los catálogos de `15-reference/`.
>
> Para añadir contexto que sobreviva a la regeneración, usa marcadores manuales:
>
> ```markdown
> <!-- MANUAL:START -->
> Contexto que mantiene el equipo.
> <!-- MANUAL:END -->
> ```
>
> El resto de notas —arquitectura, seguridad, operación, runbooks— están escritas a mano y se editan directamente.

## Frontmatter mínimo

```yaml
---
title: "Título legible"
type: "overview | architecture | domain | api | data | security | runbook | reference | audit | adr | integration"
status: "verified | inferred | draft | obsolete | needs-review"
owner: "@PabloArauzCaballero"
criticality: "low | medium | high | critical"
last_reviewed: "YYYY-MM-DD"
source_revision: "<sha corto>"
tags: []
aliases: []
related: []
---
```

## Etiquetas de evidencia

Toda afirmación relevante se clasifica: `VERIFICADO`, `INFERIDO`, `NO_CONFIRMADO`, `RIESGO`, `PENDIENTE`, `OBSOLETO`. Definiciones en [[01-overview/glossary]].

## Relaciones

- [[_meta/generation-log]] · [[00-home/navigation-map]]
