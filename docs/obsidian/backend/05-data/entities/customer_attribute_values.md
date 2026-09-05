---
title: "customer_attribute_values"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "customer_attribute_values"
orm_model: "CustomerAttributeValueModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/customer-attribute-values.model.ts"
aliases:
  - "CustomerAttributeValueModel"
---
# `catalog.customer_attribute_values`

> [!info] Verificado
> Modelo ORM `CustomerAttributeValueModel` en [`src/database/models/customer-attribute-values.model.ts`](../../../../../src/database/models/customer-attribute-values.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('customer_attribute_values')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.customer_attribute_values`
- **Modelo ORM:** `CustomerAttributeValueModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 15 · **FK salientes:** 4 · **Referencias entrantes:** 0

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
| `attributeDefinitionId` | `attribute_definition_id` | string \| null | BIGINT | No | FK | — |
| `valueText` | `value_text` | string \| null | TEXT | No | — | — |
| `valueNumber` | `value_number` | string \| null | DECIMAL(18, 4) | No | — | — |
| `valueBoolean` | `value_boolean` | boolean \| null | BOOLEAN | No | — | — |
| `valueJson` | `value_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `sourceType` | `source_type` | string \| null | STRING(60) | No | — | — |
| `evidenceId` | `evidence_id` | string \| null | BIGINT | No | FK | — |
| `confidenceScore` | `confidence_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `verificationStatus` | `verification_status` | string \| null | STRING(40) | No | — | — |
| `validFrom` | `valid_from` | Date \| null | DATE | No | — | — |
| `validUntil` | `valid_until` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `attribute_definition_id` | [[attribute_definitions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `evidence_id` | [[evidence_documents]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `customer_id`, `attribute_definition_id`, `evidence_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-attribute-values.model.ts`](../../../../../src/database/models/customer-attribute-values.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154059-schema-relationships-part-5-catalog-context.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
