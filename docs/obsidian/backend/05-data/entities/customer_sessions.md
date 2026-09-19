---
title: "customer_sessions"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "customer_sessions"
orm_model: "CustomerSessionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/customer-sessions.model.ts"
aliases:
  - "CustomerSessionModel"
---
# `telemetry.customer_sessions`

> [!info] Verificado
> Modelo ORM `CustomerSessionModel` en [`src/database/models/customer-sessions.model.ts`](../../../../../src/database/models/customer-sessions.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('customer_sessions')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.customer_sessions`
- **Modelo ORM:** `CustomerSessionModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 16 · **FK salientes:** 3 · **Referencias entrantes:** 21

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
| `deviceId` | `device_id` | string \| null | BIGINT | No | FK | — |
| `sessionTokenHash` | `session_token_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `channel` | `channel` | string \| null | STRING(40) | No | — | — |
| `authMethod` | `auth_method` | string \| null | STRING(60) | No | — | — |
| `startedAt` | `started_at` | Date \| null | DATE | No | — | — |
| `endedAt` | `ended_at` | Date \| null | DATE | No | — | — |
| `ipAddress` | `ip_address` | string \| null | INET | No | — | PII |
| `userAgent` | `user_agent` | string \| null | TEXT | No | — | — |
| `gpsLat` | `gps_lat` | string \| null | DECIMAL(10, 7) | No | — | — |
| `gpsLng` | `gps_lng` | string \| null | DECIMAL(10, 7) | No | — | — |
| `gpsAccuracyMeters` | `gps_accuracy_meters` | string \| null | DECIMAL(8, 2) | No | — | — |
| `sessionStatus` | `session_status` | string \| null | STRING(40) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 2 de 16 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `session_token_hash`, `ip_address`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[address_gps_observations]] | `session_id` | 0..N opcional |
| [[customer_consents]] | `session_id` | 0..N opcional |
| [[consent_events]] | `session_id` | 0..N opcional |
| [[evidence_documents]] | `uploaded_from_session_id` | 0..N opcional |
| [[customer_device_links]] | `first_seen_session_id` | 0..N opcional |
| [[customer_device_links]] | `last_seen_session_id` | 0..N opcional |
| [[device_snapshots]] | `session_id` | 0..N opcional |
| [[sim_observations]] | `session_id` | 0..N opcional |
| [[auth_events]] | `session_id` | 0..N opcional |
| [[ip_reputation_observations]] | `session_id` | 0..N opcional |
| [[customer_action_logs]] | `session_id` | 0..N opcional |
| [[onboarding_flows]] | `session_id` | 0..N opcional |
| [[permission_events]] | `session_id` | 0..N opcional |
| [[on_device_computation_runs]] | `session_id` | 0..N opcional |
| [[customer_observations]] | `session_id` | 0..N opcional |
| [[feature_computation_runs]] | `session_id` | 0..N opcional |
| [[feature_values]] | `session_id` | 0..N opcional |
| [[feature_snapshots]] | `session_id` | 0..N opcional |
| [[risk_assessment_runs]] | `session_id` | 0..N opcional |
| [[risk_assessment_results]] | `session_id` | 0..N opcional |
| [[watchlist_matches]] | `session_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `customer_id`, `device_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-sessions.model.ts`](../../../../../src/database/models/customer-sessions.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154057-schema-relationships-part-3-devices-sessions.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
