---
title: "context_items"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "context_items"
orm_model: "ContextItemModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/context-items.model.ts"
aliases:
  - "ContextItemModel"
---
# `catalog.context_items`

> [!info] Verificado
> Modelo ORM `ContextItemModel` en [`src/database/models/context-items.model.ts`](../../../../../src/database/models/context-items.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('context_items')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.context_items`
- **Modelo ORM:** `ContextItemModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 11 · **FK salientes:** 2 · **Referencias entrantes:** 3

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
| `catalogVersionId` | `catalog_version_id` | string \| null | BIGINT | No | FK | — |
| `itemCode` | `item_code` | string \| null | STRING(140) | No | — | — |
| `itemName` | `item_name` | string \| null | STRING(220) | No | — | — |
| `itemType` | `item_type` | string \| null | STRING(80) | No | — | — |
| `attributesJson` | `attributes_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `sourceId` | `source_id` | string \| null | BIGINT | No | FK | — |
| `confidenceScore` | `confidence_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `isActive` | `is_active` | boolean \| null | BOOLEAN | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `catalog_version_id` | [[context_catalog_versions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `source_id` | [[context_sources]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[context_item_aliases]] | `context_item_id` | 0..N opcional |
| [[context_risk_mappings]] | `context_item_id` | 0..N opcional |
| [[customer_context_enrichments]] | `matched_context_item_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `catalog_version_id, item_code` | No único | — | btree |
| `attributes_json` | No único | — | gin |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `source_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/context-items.model.ts`](../../../../../src/database/models/context-items.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154059-schema-relationships-part-5-catalog-context.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
