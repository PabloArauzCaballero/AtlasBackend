---
title: "onboarding_flows"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "onboarding_flows"
orm_model: "OnboardingFlowModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/onboarding-flows.model.ts"
aliases:
  - "OnboardingFlowModel"
---
# `telemetry.onboarding_flows`

> [!info] Verificado
> Modelo ORM `OnboardingFlowModel` en [`src/database/models/onboarding-flows.model.ts`](../../../../src/database/models/onboarding-flows.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('onboarding_flows')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.onboarding_flows`
- **Modelo ORM:** `OnboardingFlowModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 11 · **FK salientes:** 3 · **Referencias entrantes:** 10

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
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `flowVersion` | `flow_version` | string \| null | STRING(80) | No | — | — |
| `startedAt` | `started_at` | Date \| null | DATE | No | — | — |
| `completedAt` | `completed_at` | Date \| null | DATE | No | — | — |
| `abandonedAt` | `abandoned_at` | Date \| null | DATE | No | — | — |
| `completionStatus` | `completion_status` | string \| null | STRING(40) | No | — | — |
| `totalDurationSeconds` | `total_duration_seconds` | number \| null | INTEGER | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[onboarding_step_events]] | `onboarding_flow_id` | 0..N opcional |
| [[form_field_interaction_events]] | `onboarding_flow_id` | 0..N opcional |
| [[permission_events]] | `onboarding_flow_id` | 0..N opcional |
| [[onboarding_behavior_summaries]] | `onboarding_flow_id` | 0..N opcional |
| [[on_device_computation_runs]] | `onboarding_flow_id` | 0..N opcional |
| [[feature_computation_runs]] | `onboarding_flow_id` | 0..N opcional |
| [[feature_values]] | `onboarding_flow_id` | 0..N opcional |
| [[feature_snapshots]] | `onboarding_flow_id` | 0..N opcional |
| [[risk_assessment_runs]] | `onboarding_flow_id` | 0..N opcional |
| [[risk_assessment_results]] | `onboarding_flow_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `customer_id`, `session_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/onboarding-flows.model.ts`](../../../../src/database/models/onboarding-flows.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154058-schema-relationships-part-4-onboarding-behavior.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
