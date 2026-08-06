---
title: "sim_observations"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "sim_observations"
orm_model: "SimObservationModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/sim-observations.model.ts"
aliases:
  - "SimObservationModel"
---
# `telemetry.sim_observations`

> [!info] Verificado
> Modelo ORM `SimObservationModel` en [`src/database/models/sim-observations.model.ts`](../../../../src/database/models/sim-observations.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('sim_observations')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.sim_observations`
- **Modelo ORM:** `SimObservationModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 17 · **FK salientes:** 4 · **Referencias entrantes:** 0

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
| `deviceId` | `device_id` | string \| null | BIGINT | No | FK | — |
| `customerId` | `customer_id` | string \| null | BIGINT | No | FK | — |
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `phoneNumberHash` | `phone_number_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `phoneLast4` | `phone_last_4` | string \| null | STRING(4) | No | — | PII parcial |
| `carrierName` | `carrier_name` | string \| null | STRING(80) | No | — | — |
| `simType` | `sim_type` | string \| null | STRING(40) | No | — | — |
| `simCount` | `sim_count` | number \| null | INTEGER | No | — | — |
| `phoneLineTenureMonths` | `phone_line_tenure_months` | number \| null | INTEGER | No | — | PII |
| `lastSimSwapAt` | `last_sim_swap_at` | Date \| null | DATE | No | — | — |
| `simSwapDaysSince` | `sim_swap_days_since` | number \| null | INTEGER | No | — | — |
| `sourceType` | `source_type` | string \| null | STRING(60) | No | — | — |
| `confidenceScore` | `confidence_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `capturedAt` | `captured_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 3 de 17 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `phone_number_hash`, `phone_last_4`, `phone_line_tenure_months`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `device_id`, `customer_id`, `session_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/sim-observations.model.ts`](../../../../src/database/models/sim-observations.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154057-schema-relationships-part-3-devices-sessions.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
