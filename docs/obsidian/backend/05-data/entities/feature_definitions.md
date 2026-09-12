---
title: "feature_definitions"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "feature_definitions"
orm_model: "FeatureDefinitionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/feature-definitions.model.ts"
aliases:
  - "FeatureDefinitionModel"
---
# `risk.feature_definitions`

> [!info] Verificado
> Modelo ORM `FeatureDefinitionModel` en [`src/database/models/feature-definitions.model.ts`](../../../../../src/database/models/feature-definitions.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('feature_definitions')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.feature_definitions`
- **Modelo ORM:** `FeatureDefinitionModel`
- **Dominio:** Riesgo y features → [[risk-schema]]
- **Atributos:** 26 · **FK salientes:** 1 · **Referencias entrantes:** 1

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
| `featureCode` | `feature_code` | string \| null | STRING(120) | No | — | — |
| `featureName` | `feature_name` | string \| null | STRING(180) | No | — | — |
| `featureFamily` | `feature_family` | string \| null | STRING(80) | No | — | — |
| `riskDimension` | `risk_dimension` | string \| null | STRING(60) | No | — | — |
| `dataType` | `data_type` | string \| null | STRING(40) | No | — | — |
| `availabilityTier` | `availability_tier` | string \| null | STRING(40) | No | — | — |
| `buildPhase` | `build_phase` | string \| null | STRING(40) | No | — | — |
| `dataClassificationCode` | `data_classification_code` | string \| null | STRING(80) | No | — | — |
| `calculationKind` | `calculation_kind` | string \| null | STRING(60) | No | — | — |
| `defaultMissingStrategy` | `default_missing_strategy` | string \| null | STRING(80) | No | — | — |
| `isModelInput` | `is_model_input` | boolean \| null | BOOLEAN | No | — | — |
| `isPolicyRuleInput` | `is_policy_rule_input` | boolean \| null | BOOLEAN | No | — | — |
| `isSensitive` | `is_sensitive` | boolean \| null | BOOLEAN | No | — | — |
| `allowedForCreditDecision` | `allowed_for_credit_decision` | boolean \| null | BOOLEAN | No | — | — |
| `allowedForFraudDecision` | `allowed_for_fraud_decision` | boolean \| null | BOOLEAN | No | — | — |
| `legalReviewStatus` | `legal_review_status` | string \| null | STRING(40) | No | — | — |
| `prohibitedReasonCode` | `prohibited_reason_code` | string \| null | STRING(100) | No | — | — |
| `fairnessReviewRequired` | `fairness_review_required` | boolean \| null | BOOLEAN | No | — | — |
| `retentionPolicyId` | `retention_policy_id` | string \| null | BIGINT | No | FK | — |
| `ownerTeam` | `owner_team` | string \| null | STRING(80) | No | — | — |
| `domainCode` | `domain_code` | string \| null | STRING(120) | No | — | — |
| `reviewStatus` | `review_status` | string | STRING(40) | Sí | — | — |
| `isActive` | `is_active` | boolean \| null | BOOLEAN | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `retention_policy_id` | [[retention_policies]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[feature_values]] | `feature_definition_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `feature_code` | Único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `retention_policy_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/feature-definitions.model.ts`](../../../../../src/database/models/feature-definitions.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154100-schema-relationships-part-6-features-scoring.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
