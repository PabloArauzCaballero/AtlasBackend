---
title: "risk_feature_contributions"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "risk_feature_contributions"
orm_model: "RiskFeatureContributionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/risk-feature-contributions.model.ts"
aliases:
  - "RiskFeatureContributionModel"
---
# `risk.risk_feature_contributions`

> [!info] Verificado
> Modelo ORM `RiskFeatureContributionModel` en [`src/database/models/risk-feature-contributions.model.ts`](../../../../src/database/models/risk-feature-contributions.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('risk_feature_contributions')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.risk_feature_contributions`
- **Modelo ORM:** `RiskFeatureContributionModel`
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
| `riskAssessmentRunId` | `risk_assessment_run_id` | string \| null | BIGINT | No | FK | — |
| `featureCode` | `feature_code` | string \| null | STRING(120) | No | — | — |
| `rawValueJson` | `raw_value_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `binOrAttribute` | `bin_or_attribute` | string \| null | STRING(120) | No | — | — |
| `woeValue` | `woe_value` | string \| null | DECIMAL(12, 6) | No | — | — |
| `scorePoints` | `score_points` | string \| null | DECIMAL(8, 2) | No | — | — |
| `reasonCode` | `reason_code` | string \| null | STRING(100) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `risk_assessment_run_id` | [[risk_assessment_runs]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `risk_assessment_run_id` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/risk-feature-contributions.model.ts`](../../../../src/database/models/risk-feature-contributions.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154101-schema-relationships-part-7-risk-engine.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
