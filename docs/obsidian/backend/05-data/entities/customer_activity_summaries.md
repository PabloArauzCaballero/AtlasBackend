---
title: "customer_activity_summaries"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "customer_activity_summaries"
orm_model: "CustomerActivitySummaryModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/customer-activity-summaries.model.ts"
aliases:
  - "CustomerActivitySummaryModel"
---
# `telemetry.customer_activity_summaries`

> [!info] Verificado
> Modelo ORM `CustomerActivitySummaryModel` en [`src/database/models/customer-activity-summaries.model.ts`](../../../../../src/database/models/customer-activity-summaries.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('customer_activity_summaries')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.customer_activity_summaries`
- **Modelo ORM:** `CustomerActivitySummaryModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 20 · **FK salientes:** 5 · **Referencias entrantes:** 0

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`VERIFICADO` — la tabla incluye `_tenant_id`, por lo que toda consulta debe filtrar por tenant. Ver [[08-security/authorization]].

## Borrado lógico

`INFERIDO` — sin columna `_deleted`: el borrado es físico o la entidad es de solo-inserción (evento/log).

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `customerId` | `customer_id` | string | BIGINT | Sí | PK | — |
| `tenantId` | `_tenant_id` | string | BIGINT | Sí | FK | — |
| `firstSessionAt` | `first_session_at` | Date \| null | DATE | No | — | — |
| `lastSessionAt` | `last_session_at` | Date \| null | DATE | No | — | — |
| `firstDeviceId` | `first_device_id` | string \| null | BIGINT | No | FK | — |
| `usualDeviceId` | `usual_device_id` | string \| null | BIGINT | No | FK | — |
| `totalSessions` | `total_sessions` | number \| null | INTEGER | No | — | — |
| `totalDevicesSeen` | `total_devices_seen` | number \| null | INTEGER | No | — | — |
| `failedLoginCount7d` | `failed_login_count_7d` | number \| null | INTEGER | No | — | — |
| `deviceChangeCount30d` | `device_change_count_30d` | number \| null | INTEGER | No | — | — |
| `suspiciousIpCount30d` | `suspicious_ip_count_30d` | number \| null | INTEGER | No | — | — |
| `currentRiskLevel` | `current_risk_level` | string \| null | STRING(40) | No | — | — |
| `currentTrustTier` | `current_trust_tier` | string \| null | STRING(40) | No | — | — |
| `lastRiskAssessmentId` | `last_risk_assessment_id` | string \| null | BIGINT | No | FK | — |
| `lastRiskAssessedAt` | `last_risk_assessed_at` | Date \| null | DATE | No | — | — |
| `watchlistHitCountLifetime` | `watchlist_hit_count_lifetime` | number \| null | INTEGER | No | — | — |
| `fraudCaseCountLifetime` | `fraud_case_count_lifetime` | number \| null | INTEGER | No | — | — |
| `openManualReviewCount` | `open_manual_review_count` | number \| null | INTEGER | No | — | — |
| `recomputedAt` | `recomputed_at` | Date \| null | DATE | No | — | — |
| `computationVersion` | `computation_version` | string \| null | STRING(40) | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `customer_id` | [[customers]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `first_device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |
| `usual_device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |
| `last_risk_assessment_id` | [[risk_assessment_results]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 4 columna(s) FK no encabezan ningún índice: `customer_id`, `first_device_id`, `usual_device_id`, `last_risk_assessment_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-activity-summaries.model.ts`](../../../../../src/database/models/customer-activity-summaries.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154057-schema-relationships-part-3-devices-sessions.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
