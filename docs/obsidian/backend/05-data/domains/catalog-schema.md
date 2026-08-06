---
title: "Esquema catalog — Catálogo y contexto"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
schema: "catalog"
tags:
  - "backend"
  - "data"
  - "schema"
  - "schema/catalog"
source_files:
  - "src/database/domain-schemas.ts"
---
# Esquema `catalog` — Catálogo y contexto

15 tabla(s) · 212 atributos.

> [!info] Verificado
> Los esquemas físicos se declaran en `ATLAS_DOMAIN_TABLES` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts). Cada modelo resuelve el suyo con `atlasSchemaFor(tableName)`, que **lanza** si la tabla no está registrada: no existe una segunda fuente de verdad.

## Tablas

| Tabla | Modelo ORM | Atributos | FK salientes | Referencias entrantes |
|---|---|---|---|---|
| [[attribute_definitions]] | `AttributeDefinitionModel` | 25 | 1 | 1 |
| [[context_approval_events]] | `ContextApprovalEventModel` | 8 | 3 | 0 |
| [[context_catalog_versions]] | `ContextCatalogVersionModel` | 13 | 3 | 3 |
| [[context_catalogs]] | `ContextCatalogModel` | 9 | 0 | 3 |
| [[context_ingestion_jobs]] | `ContextIngestionJobModel` | 11 | 0 | 1 |
| [[context_item_aliases]] | `ContextItemAliasModel` | 7 | 1 | 0 |
| [[context_items]] | `ContextItemModel` | 11 | 2 | 3 |
| [[context_risk_mappings]] | `ContextRiskMappingModel` | 13 | 1 | 0 |
| [[context_sources]] | `ContextSourceModel` | 10 | 0 | 1 |
| [[context_staging_items]] | `ContextStagingItemModel` | 13 | 3 | 1 |
| [[customer_attribute_values]] | `CustomerAttributeValueModel` | 15 | 4 | 0 |
| [[customer_context_enrichments]] | `CustomerContextEnrichmentModel` | 16 | 6 | 0 |
| [[customer_observations]] | `CustomerObservationModel` | 21 | 6 | 1 |
| [[event_definitions]] | `EventDefinitionModel` | 18 | 1 | 0 |
| [[observation_definitions]] | `ObservationDefinitionModel` | 22 | 1 | 0 |

## Acoplamiento con otros esquemas

- **Depende de** (FK salientes hacia): [[iam-schema|iam]], [[privacy-schema|privacy]], [[customer-schema|customer]], [[telemetry-schema|telemetry]], [[integrations-schema|integrations]]
- **Es referenciado por**: ninguno
- FK que cruzan el límite del esquema: **18 salientes**, **0 entrantes**.

> [!warning] Acoplamiento físico entre dominios
> Las FK que cruzan esquemas atan estos dominios a nivel de base de datos: no se pueden separar en bases distintas sin sustituir la integridad referencial por validación en aplicación. Ver [[02-architecture/module-boundaries]].

## Diagrama entidad-relación (intra-esquema)

```mermaid
erDiagram
  context_catalogs ||--o{ context_catalog_versions : "catalog_id"
  context_catalog_versions ||--o{ context_items : "catalog_version_id"
  context_sources ||--o{ context_items : "source_id"
  context_items ||--o{ context_item_aliases : "context_item_id"
  context_items ||--o{ context_risk_mappings : "context_item_id"
  context_catalogs ||--o{ context_staging_items : "catalog_id"
  context_ingestion_jobs ||--o{ context_staging_items : "ingestion_job_id"
  context_staging_items ||--o{ context_approval_events : "staging_item_id"
  context_catalog_versions ||--o{ context_approval_events : "catalog_version_id"
  attribute_definitions ||--o{ customer_attribute_values : "attribute_definition_id"
  customer_observations ||--o{ customer_context_enrichments : "observation_id"
  context_catalogs ||--o{ customer_context_enrichments : "catalog_id"
  context_catalog_versions ||--o{ customer_context_enrichments : "catalog_version_id"
  context_items ||--o{ customer_context_enrichments : "matched_context_item_id"
```

Solo se representan las relaciones cuyos dos extremos viven en `catalog`. Las relaciones cruzadas están en [[05-data/relationship-catalog]].

## Relaciones

- Modelo global: [[05-data/entity-relationship-model]]
- Arquitectura de datos: [[05-data/data-architecture]]
