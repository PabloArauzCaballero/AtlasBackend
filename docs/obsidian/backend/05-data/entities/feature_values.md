---
title: "feature_values"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "feature_values"
orm_model: "FeatureValueModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/feature-values.model.ts"
aliases:
  - "FeatureValueModel"
---
# `risk.feature_values`

> [!info] Verificado
> Modelo ORM `FeatureValueModel` en [`src/database/models/feature-values.model.ts`](../../../../src/database/models/feature-values.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('feature_values')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.feature_values`
- **Modelo ORM:** `FeatureValueModel`
- **Dominio:** Riesgo y features → [[risk-schema]]
- **Atributos:** 20 · **FK salientes:** 7 · **Referencias entrantes:** 1

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
| `computationRunId` | `computation_run_id` | string \| null | BIGINT | No | FK | — |
| `featureDefinitionId` | `feature_definition_id` | string \| null | BIGINT | No | FK | — |
| `subjectType` | `subject_type` | string \| null | STRING(40) | No | — | — |
| `subjectId` | `subject_id` | string \| null | BIGINT | No | — | — |
| `customerId` | `customer_id` | string \| null | BIGINT | No | FK | — |
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `onboardingFlowId` | `onboarding_flow_id` | string \| null | BIGINT | No | FK | — |
| `deviceId` | `device_id` | string \| null | BIGINT | No | FK | — |
| `valueText` | `value_text` | string \| null | TEXT | No | — | — |
| `valueNumber` | `value_number` | string \| null | DECIMAL(18, 4) | No | — | — |
| `valueBoolean` | `value_boolean` | boolean \| null | BOOLEAN | No | — | — |
| `valueJson` | `value_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `confidenceScore` | `confidence_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `derivationMethod` | `derivation_method` | string \| null | STRING(120) | No | — | — |
| `derivationVersion` | `derivation_version` | string \| null | STRING(80) | No | — | — |
| `validFrom` | `valid_from` | Date \| null | DATE | No | — | — |
| `validUntil` | `valid_until` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `computation_run_id` | [[feature_computation_runs]] | `_id` | Opcional (0..1) | `SET NULL` |
| `feature_definition_id` | [[feature_definitions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `onboarding_flow_id` | [[onboarding_flows]] | `_id` | Opcional (0..1) | `SET NULL` |
| `device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[feature_lineage_links]] | `feature_value_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `` | No único | — | btree |
| `` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 6 columna(s) FK no encabezan ningún índice: `computation_run_id`, `feature_definition_id`, `customer_id`, `session_id`, `onboarding_flow_id`, `device_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/feature-values.model.ts`](../../../../src/database/models/feature-values.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154100-schema-relationships-part-6-features-scoring.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
