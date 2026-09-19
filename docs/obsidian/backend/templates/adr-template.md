---
title: "Plantilla — ADR"
type: "reference"
status: "draft"
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
# Plantilla — ADR

> [!info] Los ADR canónicos viven en `docs/adr/`
> Crear el ADR real ahí (plantilla: [`docs/adr/_template.md`](../../../adr/_template.md)) y añadir en `02-architecture/adr/` una nota que lo resuma y lo enlace con la bóveda.

```markdown
---
title: "ADR-<NNN> — <decisión>"
type: adr
status: accepted
last_reviewed: "YYYY-MM-DD"
tags: [backend, architecture, adr]
---

# ADR-<NNN> — <decisión>

## Estado
Proposed | Accepted | Superseded | Deprecated | Rejected

## Contexto
## Problema
## Alternativas consideradas
### Opción A
### Opción B
## Decisión
## Consecuencias
## Evidencia
## ADR relacionados
```

> [!warning] No inventes decisiones históricas
> Si la decisión se **infiere** del código y nadie la tomó formalmente, márcala como `inferred` o escribe una nota de arquitectura en vez de un ADR.
