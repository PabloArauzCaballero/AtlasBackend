---
title: "onboarding_behavior_summaries"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "onboarding_behavior_summaries"
orm_model: "OnboardingBehaviorSummaryModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/onboarding-behavior-summaries.model.ts"
aliases:
  - "OnboardingBehaviorSummaryModel"
---
# `telemetry.onboarding_behavior_summaries`

> [!info] Verificado
> Modelo ORM `OnboardingBehaviorSummaryModel` en [`src/database/models/onboarding-behavior-summaries.model.ts`](../../../../src/database/models/onboarding-behavior-summaries.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('onboarding_behavior_summaries')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.onboarding_behavior_summaries`
- **Modelo ORM:** `OnboardingBehaviorSummaryModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 15 · **FK salientes:** 3 · **Referencias entrantes:** 0

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
| `onboardingFlowId` | `onboarding_flow_id` | string \| null | BIGINT | No | FK | — |
| `completionTimeSeconds` | `completion_time_seconds` | number \| null | INTEGER | No | — | — |
| `interScreenTimingJson` | `inter_screen_timing_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `formErrorRate` | `form_error_rate` | string \| null | DECIMAL(8, 4) | No | — | — |
| `ciCopyPasteDetected` | `ci_copy_paste_detected` | boolean \| null | BOOLEAN | No | — | — |
| `abandonmentCountPrior` | `abandonment_count_prior` | number \| null | INTEGER | No | — | — |
| `permissionGrantScore` | `permission_grant_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `behaviorClusterCode` | `behavior_cluster_code` | string \| null | STRING(80) | No | — | — |
| `botLikelihoodScore` | `bot_likelihood_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `computationVersion` | `computation_version` | string \| null | STRING(40) | No | — | — |
| `computedAt` | `computed_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `onboarding_flow_id` | [[onboarding_flows]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `customer_id`, `onboarding_flow_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/onboarding-behavior-summaries.model.ts`](../../../../src/database/models/onboarding-behavior-summaries.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154058-schema-relationships-part-4-onboarding-behavior.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
