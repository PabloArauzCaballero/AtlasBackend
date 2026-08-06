---
title: "Esquema case_management — Gestión de casos y fraude"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
schema: "case_management"
tags:
  - "backend"
  - "data"
  - "schema"
  - "schema/case_management"
source_files:
  - "src/database/domain-schemas.ts"
---
# Esquema `case_management` — Gestión de casos y fraude

6 tabla(s) · 89 atributos.

> [!info] Verificado
> Los esquemas físicos se declaran en `ATLAS_DOMAIN_TABLES` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts). Cada modelo resuelve el suyo con `atlasSchemaFor(tableName)`, que **lanza** si la tabla no está registrada: no existe una segunda fuente de verdad.

## Tablas

| Tabla | Modelo ORM | Atributos | FK salientes | Referencias entrantes |
|---|---|---|---|---|
| [[fraud_case_events]] | `FraudCaseEventModel` | 10 | 3 | 0 |
| [[fraud_cases]] | `FraudCaseModel` | 20 | 5 | 3 |
| [[manual_review_cases]] | `ManualReviewCaseModel` | 17 | 5 | 3 |
| [[manual_review_events]] | `ManualReviewEventModel` | 10 | 3 | 0 |
| [[watchlist_entries]] | `WatchlistEntryModel` | 18 | 3 | 1 |
| [[watchlist_matches]] | `WatchlistMatchModel` | 14 | 7 | 0 |

## Acoplamiento con otros esquemas

- **Depende de** (FK salientes hacia): [[iam-schema|iam]], [[customer-schema|customer]], [[risk-schema|risk]], [[telemetry-schema|telemetry]]
- **Es referenciado por**: ninguno
- FK que cruzan el límite del esquema: **19 salientes**, **0 entrantes**.

> [!warning] Acoplamiento físico entre dominios
> Las FK que cruzan esquemas atan estos dominios a nivel de base de datos: no se pueden separar en bases distintas sin sustituir la integridad referencial por validación en aplicación. Ver [[02-architecture/module-boundaries]].

## Diagrama entidad-relación (intra-esquema)

```mermaid
erDiagram
  fraud_cases ||--o{ manual_review_cases : "fraud_case_id"
  manual_review_cases ||--o{ manual_review_events : "manual_review_case_id"
  manual_review_cases ||--o{ fraud_cases : "escalated_from_review_case_id"
  fraud_cases ||--o{ fraud_case_events : "fraud_case_id"
  watchlist_entries ||--o{ watchlist_matches : "watchlist_entry_id"
  manual_review_cases ||--o{ watchlist_matches : "opened_review_case_id"
  fraud_cases ||--o{ watchlist_matches : "opened_fraud_case_id"
```

Solo se representan las relaciones cuyos dos extremos viven en `case_management`. Las relaciones cruzadas están en [[05-data/relationship-catalog]].

## Relaciones

- Modelo global: [[05-data/entity-relationship-model]]
- Arquitectura de datos: [[05-data/data-architecture]]
