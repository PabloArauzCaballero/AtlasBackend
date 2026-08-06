---
title: "risk_assessment_runs"
type: "data"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "risk_assessment_runs"
orm_model: "RiskAssessmentRunModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/risk-assessment-runs.model.ts"
aliases:
  - "RiskAssessmentRunModel"
---
# `risk.risk_assessment_runs`

> [!info] Verificado
> Modelo ORM `RiskAssessmentRunModel` en [`src/database/models/risk-assessment-runs.model.ts`](../../../../src/database/models/risk-assessment-runs.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('risk_assessment_runs')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.risk_assessment_runs`
- **Modelo ORM:** `RiskAssessmentRunModel`
- **Dominio:** Riesgo y features → [[risk-schema]]
- **Atributos:** 19 · **FK salientes:** 8 · **Referencias entrantes:** 7

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
| `subjectType` | `subject_type` | string \| null | STRING(40) | No | — | — |
| `subjectId` | `subject_id` | string \| null | BIGINT | No | — | — |
| `customerId` | `customer_id` | string \| null | BIGINT | No | FK | — |
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `onboardingFlowId` | `onboarding_flow_id` | string \| null | BIGINT | No | FK | — |
| `deviceId` | `device_id` | string \| null | BIGINT | No | FK | — |
| `featureSnapshotId` | `feature_snapshot_id` | string \| null | BIGINT | No | FK | — |
| `riskModelVersionId` | `risk_model_version_id` | string \| null | BIGINT | No | FK | — |
| `riskRulesetVersionId` | `risk_ruleset_version_id` | string \| null | BIGINT | No | FK | — |
| `assessmentType` | `assessment_type` | string \| null | STRING(80) | No | — | — |
| `triggerSource` | `trigger_source` | string \| null | STRING(80) | No | — | — |
| `idempotencyKey` | `idempotency_key` | string \| null | STRING(128) | No | — | — |
| `runStatus` | `run_status` | string \| null | STRING(40) | No | — | — |
| `startedAt` | `started_at` | Date \| null | DATE | No | — | — |
| `completedAt` | `completed_at` | Date \| null | DATE | No | — | — |
| `latencyMs` | `latency_ms` | number \| null | INTEGER | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `onboarding_flow_id` | [[onboarding_flows]] | `_id` | Opcional (0..1) | `SET NULL` |
| `device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |
| `feature_snapshot_id` | [[feature_snapshots]] | `_id` | Opcional (0..1) | `SET NULL` |
| `risk_model_version_id` | [[risk_model_versions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `risk_ruleset_version_id` | [[risk_ruleset_versions]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[data_provider_requests]] | `risk_assessment_run_id` | 0..N opcional |
| [[feature_snapshots]] | `risk_assessment_run_id` | 0..N opcional |
| [[risk_assessment_contexts]] | `risk_assessment_run_id` | 0..N opcional |
| [[risk_rules_fired]] | `risk_assessment_run_id` | 0..N opcional |
| [[risk_feature_contributions]] | `risk_assessment_run_id` | 0..N opcional |
| [[risk_assessment_results]] | `risk_assessment_run_id` | 0..N opcional |
| [[manual_review_cases]] | `risk_assessment_run_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `` | No único | — | btree |
| `` | No único | — | btree |
| `` | No único | — | btree |
| `` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 7 columna(s) FK no encabezan ningún índice: `customer_id`, `session_id`, `onboarding_flow_id`, `device_id`, `feature_snapshot_id`, `risk_model_version_id`, `risk_ruleset_version_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

- `ck_risk_assessment_subject_present`: `customer_id IS NOT NULL OR session_id IS NOT NULL OR onboarding_flow_id IS NOT NULL OR device_id IS NOT NULL` — origen: `20260626154101-schema-relationships-part-7-risk-engine.ts`

## Evidencia y referencias

- Modelo: [`src/database/models/risk-assessment-runs.model.ts`](../../../../src/database/models/risk-assessment-runs.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154101-schema-relationships-part-7-risk-engine.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
