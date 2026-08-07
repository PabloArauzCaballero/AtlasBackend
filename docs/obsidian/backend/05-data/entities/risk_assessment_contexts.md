---
title: "risk_assessment_contexts"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "risk_assessment_contexts"
orm_model: "RiskAssessmentContextModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/risk-assessment-contexts.model.ts"
aliases:
  - "RiskAssessmentContextModel"
---
# `risk.risk_assessment_contexts`

> [!info] Verificado
> Modelo ORM `RiskAssessmentContextModel` en [`src/database/models/risk-assessment-contexts.model.ts`](../../../../../src/database/models/risk-assessment-contexts.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('risk_assessment_contexts')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.risk_assessment_contexts`
- **Modelo ORM:** `RiskAssessmentContextModel`
- **Dominio:** Riesgo y features → [[risk-schema]]
- **Atributos:** 24 · **FK salientes:** 2 · **Referencias entrantes:** 0

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
| `contextType` | `context_type` | string \| null | STRING(80) | No | — | — |
| `externalEntityType` | `external_entity_type` | string \| null | STRING(80) | No | — | — |
| `externalEntityId` | `external_entity_id` | string \| null | STRING(120) | No | — | — |
| `merchantIdSnapshot` | `merchant_id_snapshot` | string \| null | BIGINT | No | — | — |
| `merchantCodeSnapshot` | `merchant_code_snapshot` | string \| null | STRING(80) | No | — | — |
| `merchantRiskBandSnapshot` | `merchant_risk_band_snapshot` | string \| null | STRING(40) | No | — | — |
| `merchantDefaultRateSnapshot` | `merchant_default_rate_snapshot` | string \| null | DECIMAL(8, 4) | No | — | — |
| `storeIdSnapshot` | `store_id_snapshot` | string \| null | BIGINT | No | — | — |
| `productCategorySnapshot` | `product_category_snapshot` | string \| null | STRING(80) | No | — | — |
| `productSubcategorySnapshot` | `product_subcategory_snapshot` | string \| null | STRING(80) | No | — | — |
| `basketItemCountSnapshot` | `basket_item_count_snapshot` | number \| null | INTEGER | No | — | — |
| `basketDuplicateItemCountSnapshot` | `basket_duplicate_item_count_snapshot` | number \| null | INTEGER | No | — | — |
| `basketAnomalyScore` | `basket_anomaly_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `transactionAmountSnapshot` | `transaction_amount_snapshot` | string \| null | DECIMAL(14, 2) | No | — | — |
| `currencyCode` | `currency_code` | string \| null | STRING(3) | No | — | — |
| `purchaseToDeclaredIncomeRatio` | `purchase_to_declared_income_ratio` | string \| null | DECIMAL(10, 4) | No | — | — |
| `downPaymentRequiredPctSnapshot` | `down_payment_required_pct_snapshot` | string \| null | DECIMAL(8, 4) | No | — | — |
| `downPaymentBehaviorSnapshot` | `down_payment_behavior_snapshot` | Record<string, unknown> \| null | JSONB | No | — | — |
| `storeToHomeDistanceMeters` | `store_to_home_distance_meters` | string \| null | DECIMAL(12, 2) | No | — | — |
| `contextPayloadHash` | `context_payload_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 24 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `context_payload_hash`. Ver [[05-data/sensitive-data]].

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
| `` | No único | — | btree |
| `` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/risk-assessment-contexts.model.ts`](../../../../../src/database/models/risk-assessment-contexts.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154101-schema-relationships-part-7-risk-engine.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
