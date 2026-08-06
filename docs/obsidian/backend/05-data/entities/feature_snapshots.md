---
title: "feature_snapshots"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "feature_snapshots"
orm_model: "FeatureSnapshotModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/feature-snapshots.model.ts"
aliases:
  - "FeatureSnapshotModel"
---
# `risk.feature_snapshots`

> [!info] Verificado
> Modelo ORM `FeatureSnapshotModel` en [`src/database/models/feature-snapshots.model.ts`](../../../../src/database/models/feature-snapshots.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('feature_snapshots')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.feature_snapshots`
- **Modelo ORM:** `FeatureSnapshotModel`
- **Dominio:** Riesgo y features → [[risk-schema]]
- **Atributos:** 18 · **FK salientes:** 6 · **Referencias entrantes:** 2

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
| `deviceId` | `device_id` | string \| null | BIGINT | No | FK | — |
| `snapshotReason` | `snapshot_reason` | string \| null | STRING(80) | No | — | — |
| `triggeringEntityType` | `triggering_entity_type` | string \| null | STRING(80) | No | — | — |
| `triggeringEntityId` | `triggering_entity_id` | string \| null | BIGINT | No | — | — |
| `riskAssessmentRunId` | `risk_assessment_run_id` | string \| null | BIGINT | No | FK | — |
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `onboardingFlowId` | `onboarding_flow_id` | string \| null | BIGINT | No | FK | — |
| `featureSetVersion` | `feature_set_version` | string \| null | STRING(80) | No | — | — |
| `catalogVersionsJson` | `catalog_versions_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `featuresJson` | `features_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `missingFeaturesJson` | `missing_features_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `integrityHash` | `integrity_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 18 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `integrity_hash`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |
| `risk_assessment_run_id` | [[risk_assessment_runs]] | `_id` | Opcional (0..1) | `SET NULL` |
| `session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `onboarding_flow_id` | [[onboarding_flows]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[risk_assessment_runs]] | `feature_snapshot_id` | 0..N opcional |
| [[risk_assessment_results]] | `feature_snapshot_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `` | No único | — | btree |
| `` | No único | — | btree |
| `` | No único | — | btree |
| `` | No único | — | btree |
| `features_json` | No único | — | gin |
| `risk_assessment_run_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 4 columna(s) FK no encabezan ningún índice: `customer_id`, `device_id`, `session_id`, `onboarding_flow_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/feature-snapshots.model.ts`](../../../../src/database/models/feature-snapshots.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154100-schema-relationships-part-6-features-scoring.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
