---
title: "system_data_relationship_catalog"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_data_relationship_catalog"
orm_model: "SystemDataRelationshipCatalogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-data-relationship-catalog.model.ts"
aliases:
  - "SystemDataRelationshipCatalogModel"
---
# `platform_ops.system_data_relationship_catalog`

> [!info] Verificado
> Modelo ORM `SystemDataRelationshipCatalogModel` en [`src/database/models/system-data-relationship-catalog.model.ts`](../../../../../src/database/models/system-data-relationship-catalog.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_data_relationship_catalog')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_data_relationship_catalog`
- **Modelo ORM:** `SystemDataRelationshipCatalogModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 24 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `sourceDataEntityId` | `source_data_entity_id` | string \| null | BIGINT | No | — | — |
| `targetDataEntityId` | `target_data_entity_id` | string \| null | BIGINT | No | — | — |
| `sourceSchema` | `source_schema` | string | STRING(120) | Sí | — | — |
| `sourceTable` | `source_table` | string | STRING(180) | Sí | — | — |
| `sourceColumn` | `source_column` | string \| null | STRING(180) | No | — | — |
| `targetSchema` | `target_schema` | string | STRING(120) | Sí | — | — |
| `targetTable` | `target_table` | string | STRING(180) | Sí | — | — |
| `targetColumn` | `target_column` | string \| null | STRING(180) | No | — | — |
| `relationshipType` | `relationship_type` | string | STRING(80) | Sí | — | — |
| `cardinality` | `cardinality` | string | STRING(20) | Sí | — | — |
| `optionality` | `optionality` | string | STRING(60) | Sí | — | — |
| `businessReason` | `business_reason` | string \| null | TEXT | No | — | — |
| `technicalReason` | `technical_reason` | string \| null | TEXT | No | — | — |
| `auditUsage` | `audit_usage` | string \| null | TEXT | No | — | — |
| `analysisUsage` | `analysis_usage` | string \| null | TEXT | No | — | — |
| `decisionUsage` | `decision_usage` | string \| null | TEXT | No | — | — |
| `enforcementStrategy` | `enforcement_strategy` | string \| null | STRING(80) | No | — | — |
| `deletePolicy` | `delete_policy` | string \| null | STRING(80) | No | — | — |
| `sourceDocument` | `source_document` | string | STRING(120) | Sí | — | — |
| `confidenceLevel` | `confidence_level` | string | STRING(20) | Sí | — | — |
| `reviewStatus` | `review_status` | string | STRING(40) | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| — | — | — | — | — |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `source_schema, source_table, COALESCE(source_column, ''` | Único | — | btree |
| `source_table` | No único | — | btree |
| `target_table` | No único | — | btree |
| `source_schema, source_table, COALESCE(source_column, ''` | Único | — | btree |
| `source_table` | No único | — | btree |
| `target_table` | No único | — | btree |
| `source_data_entity_id` | No único | — | btree |
| `target_data_entity_id` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-data-relationship-catalog.model.ts`](../../../../../src/database/models/system-data-relationship-catalog.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
