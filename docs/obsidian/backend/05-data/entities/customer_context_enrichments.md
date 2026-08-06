---
title: "customer_context_enrichments"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "customer_context_enrichments"
orm_model: "CustomerContextEnrichmentModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/customer-context-enrichments.model.ts"
aliases:
  - "CustomerContextEnrichmentModel"
---
# `catalog.customer_context_enrichments`

> [!info] Verificado
> Modelo ORM `CustomerContextEnrichmentModel` en [`src/database/models/customer-context-enrichments.model.ts`](../../../../src/database/models/customer-context-enrichments.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('customer_context_enrichments')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.customer_context_enrichments`
- **Modelo ORM:** `CustomerContextEnrichmentModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 16 · **FK salientes:** 6 · **Referencias entrantes:** 0

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`VERIFICADO` — la tabla incluye `_tenant_id`, por lo que toda consulta debe filtrar por tenant. Ver [[08-security/authorization]].

## Borrado lógico

`INFERIDO` — sin columna `_deleted`: el borrado es físico o la entidad es de solo-inserción (evento/log).

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `tenantId` | `_tenant_id` | string | BIGINT | Sí | FK | — |
| `customerId` | `customer_id` | string \| null | BIGINT | No | FK | — |
| `observationId` | `observation_id` | string \| null | BIGINT | No | FK | — |
| `catalogId` | `catalog_id` | string \| null | BIGINT | No | FK | — |
| `catalogVersionId` | `catalog_version_id` | string \| null | BIGINT | No | FK | — |
| `matchedContextItemId` | `matched_context_item_id` | string \| null | BIGINT | No | FK | — |
| `catalogCodeSnapshot` | `catalog_code_snapshot` | string \| null | STRING(80) | No | — | — |
| `catalogVersionCodeSnapshot` | `catalog_version_code_snapshot` | string \| null | STRING(60) | No | — | — |
| `matchedItemCodeSnapshot` | `matched_item_code_snapshot` | string \| null | STRING(140) | No | — | — |
| `matchedItemNameSnapshot` | `matched_item_name_snapshot` | string \| null | STRING(220) | No | — | — |
| `enrichmentCode` | `enrichment_code` | string \| null | STRING(120) | No | — | — |
| `enrichmentValueJson` | `enrichment_value_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `confidenceScore` | `confidence_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `matchMethod` | `match_method` | string \| null | STRING(80) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `observation_id` | [[customer_observations]] | `_id` | Opcional (0..1) | `SET NULL` |
| `catalog_id` | [[context_catalogs]] | `_id` | Opcional (0..1) | `SET NULL` |
| `catalog_version_id` | [[context_catalog_versions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `matched_context_item_id` | [[context_items]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 5 columna(s) FK no encabezan ningún índice: `customer_id`, `observation_id`, `catalog_id`, `catalog_version_id`, `matched_context_item_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-context-enrichments.model.ts`](../../../../src/database/models/customer-context-enrichments.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154059-schema-relationships-part-5-catalog-context.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
