---
title: "context_catalog_versions"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "context_catalog_versions"
orm_model: "ContextCatalogVersionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/context-catalog-versions.model.ts"
aliases:
  - "ContextCatalogVersionModel"
---
# `catalog.context_catalog_versions`

> [!info] Verificado
> Modelo ORM `ContextCatalogVersionModel` en [`src/database/models/context-catalog-versions.model.ts`](../../../../src/database/models/context-catalog-versions.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('context_catalog_versions')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.context_catalog_versions`
- **Modelo ORM:** `ContextCatalogVersionModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 13 · **FK salientes:** 3 · **Referencias entrantes:** 3

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
| `versionCode` | `version_code` | string \| null | STRING(60) | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `validFrom` | `valid_from` | string \| null | DATEONLY | No | — | — |
| `validUntil` | `valid_until` | string \| null | DATEONLY | No | — | — |
| `createdByType` | `created_by_type` | string \| null | STRING(40) | No | — | — |
| `createdByPlatformUserId` | `created_by_platform_user_id` | string \| null | BIGINT | No | FK | — |
| `approvedByType` | `approved_by_type` | string \| null | STRING(40) | No | — | — |
| `approvedByPlatformUserId` | `approved_by_platform_user_id` | string \| null | BIGINT | No | FK | — |
| `approvedAt` | `approved_at` | Date \| null | DATE | No | — | — |
| `notes` | `notes` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `catalog_id` | [[context_catalogs]] | `_id` | Opcional (0..1) | `SET NULL` |
| `created_by_platform_user_id` | [[platform_users]] | `_id` | Opcional (0..1) | `SET NULL` |
| `approved_by_platform_user_id` | [[platform_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[context_items]] | `catalog_version_id` | 0..N opcional |
| [[context_approval_events]] | `catalog_version_id` | 0..N opcional |
| [[customer_context_enrichments]] | `catalog_version_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| — | — | — | — |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `catalog_id`, `created_by_platform_user_id`, `approved_by_platform_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/context-catalog-versions.model.ts`](../../../../src/database/models/context-catalog-versions.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154059-schema-relationships-part-5-catalog-context.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
