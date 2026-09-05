---
title: "feature_lineage_links"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "feature_lineage_links"
orm_model: "FeatureLineageLinkModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/feature-lineage-links.model.ts"
aliases:
  - "FeatureLineageLinkModel"
---
# `risk.feature_lineage_links`

> [!info] Verificado
> Modelo ORM `FeatureLineageLinkModel` en [`src/database/models/feature-lineage-links.model.ts`](../../../../../src/database/models/feature-lineage-links.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('feature_lineage_links')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.feature_lineage_links`
- **Modelo ORM:** `FeatureLineageLinkModel`
- **Dominio:** Riesgo y features → [[risk-schema]]
- **Atributos:** 10 · **FK salientes:** 2 · **Referencias entrantes:** 0

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
| `featureValueId` | `feature_value_id` | string \| null | BIGINT | No | FK | — |
| `sourceType` | `source_type` | string \| null | STRING(80) | No | — | — |
| `sourceTable` | `source_table` | string \| null | STRING(120) | No | — | — |
| `sourceRecordId` | `source_record_id` | string \| null | STRING(120) | No | — | — |
| `sourceCode` | `source_code` | string \| null | STRING(120) | No | — | — |
| `sourceSnapshotJson` | `source_snapshot_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `contributionWeight` | `contribution_weight` | string \| null | DECIMAL(8, 4) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `feature_value_id` | [[feature_values]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `feature_value_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/feature-lineage-links.model.ts`](../../../../../src/database/models/feature-lineage-links.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154100-schema-relationships-part-6-features-scoring.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
