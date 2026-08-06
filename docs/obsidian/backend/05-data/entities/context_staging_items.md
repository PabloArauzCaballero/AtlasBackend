---
title: "context_staging_items"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "context_staging_items"
orm_model: "ContextStagingItemModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/context-staging-items.model.ts"
aliases:
  - "ContextStagingItemModel"
---
# `catalog.context_staging_items`

> [!info] Verificado
> Modelo ORM `ContextStagingItemModel` en [`src/database/models/context-staging-items.model.ts`](../../../../src/database/models/context-staging-items.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('context_staging_items')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.context_staging_items`
- **Modelo ORM:** `ContextStagingItemModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 13 · **FK salientes:** 3 · **Referencias entrantes:** 1

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`RIESGO` — la tabla **no** tiene `_tenant_id`: es global a la plataforma o el aislamiento depende de la tabla padre. Verificar antes de exponerla en un endpoint por tenant.

## Borrado lógico

`INFERIDO` — sin columna `_deleted`: el borrado es físico o la entidad es de solo-inserción (evento/log).

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `catalogId` | `catalog_id` | string \| null | BIGINT | No | FK | — |
| `ingestionJobId` | `ingestion_job_id` | string \| null | BIGINT | No | FK | — |
| `proposedItemCode` | `proposed_item_code` | string \| null | STRING(140) | No | — | — |
| `proposedItemName` | `proposed_item_name` | string \| null | STRING(220) | No | — | — |
| `proposedAttributesJson` | `proposed_attributes_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `aiSuggested` | `ai_suggested` | boolean \| null | BOOLEAN | No | — | — |
| `reviewStatus` | `review_status` | string \| null | STRING(40) | No | — | — |
| `reviewNotes` | `review_notes` | string \| null | TEXT | No | — | — |
| `createdByType` | `created_by_type` | string \| null | STRING(40) | No | — | — |
| `createdByPlatformUserId` | `created_by_platform_user_id` | string \| null | BIGINT | No | FK | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `catalog_id` | [[context_catalogs]] | `_id` | Opcional (0..1) | `SET NULL` |
| `ingestion_job_id` | [[context_ingestion_jobs]] | `_id` | Opcional (0..1) | `SET NULL` |
| `created_by_platform_user_id` | [[platform_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[context_approval_events]] | `staging_item_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| — | — | — | — |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `catalog_id`, `ingestion_job_id`, `created_by_platform_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/context-staging-items.model.ts`](../../../../src/database/models/context-staging-items.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154059-schema-relationships-part-5-catalog-context.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
