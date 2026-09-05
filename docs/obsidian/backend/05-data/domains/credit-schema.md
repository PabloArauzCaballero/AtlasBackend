---
title: "Esquema credit — Crédito"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
schema: "credit"
tags:
  - "backend"
  - "data"
  - "schema"
  - "schema/credit"
source_files:
  - "src/database/domain-schemas.ts"
---
# Esquema `credit` — Crédito

3 tabla(s) · 54 atributos.

> [!info] Verificado
> Los esquemas físicos se declaran en `ATLAS_DOMAIN_TABLES` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts). Cada modelo resuelve el suyo con `atlasSchemaFor(tableName)`, que **lanza** si la tabla no está registrada: no existe una segunda fuente de verdad.

## Tablas

| Tabla | Modelo ORM | Atributos | FK salientes | Referencias entrantes |
|---|---|---|---|---|
| [[credit_application_events]] | `CreditApplicationEventModel` | 13 | 0 | 0 |
| [[credit_applications]] | `CreditApplicationModel` | 21 | 0 | 0 |
| [[credit_products]] | `CreditProductModel` | 20 | 0 | 0 |

## Acoplamiento con otros esquemas

- **Depende de** (FK salientes hacia): ninguno
- **Es referenciado por**: ninguno
- FK que cruzan el límite del esquema: **0 salientes**, **0 entrantes**.



## Diagrama entidad-relación (intra-esquema)

```mermaid
erDiagram
  %% sin relaciones internas a este esquema
```

Solo se representan las relaciones cuyos dos extremos viven en `credit`. Las relaciones cruzadas están en [[05-data/relationship-catalog]].

## Relaciones

- Modelo global: [[05-data/entity-relationship-model]]
- Arquitectura de datos: [[05-data/data-architecture]]
