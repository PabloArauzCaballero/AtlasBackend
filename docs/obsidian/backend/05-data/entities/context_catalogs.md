---
title: "context_catalogs"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "context_catalogs"
orm_model: "ContextCatalogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/context-catalogs.model.ts"
aliases:
  - "ContextCatalogModel"
---
# `catalog.context_catalogs`

> [!info] Verificado
> Modelo ORM `ContextCatalogModel` en [`src/database/models/context-catalogs.model.ts`](../../../../src/database/models/context-catalogs.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('context_catalogs')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.context_catalogs`
- **Modelo ORM:** `ContextCatalogModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 9 · **FK salientes:** 0 · **Referencias entrantes:** 3

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
| `catalogCode` | `catalog_code` | string \| null | STRING(80) | No | — | — |
| `catalogName` | `catalog_name` | string \| null | STRING(180) | No | — | — |
| `domain` | `domain` | string \| null | STRING(80) | No | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `ownerTeam` | `owner_team` | string \| null | STRING(80) | No | — | — |
| `isActive` | `is_active` | boolean \| null | BOOLEAN | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| — | — | — | — | — |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[context_catalog_versions]] | `catalog_id` | 0..N opcional |
| [[context_staging_items]] | `catalog_id` | 0..N opcional |
| [[customer_context_enrichments]] | `catalog_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `catalog_code` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/context-catalogs.model.ts`](../../../../src/database/models/context-catalogs.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
