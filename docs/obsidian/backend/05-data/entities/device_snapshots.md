---
title: "device_snapshots"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "device_snapshots"
orm_model: "DeviceSnapshotModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/device-snapshots.model.ts"
aliases:
  - "DeviceSnapshotModel"
---
# `telemetry.device_snapshots`

> [!info] Verificado
> Modelo ORM `DeviceSnapshotModel` en [`src/database/models/device-snapshots.model.ts`](../../../../src/database/models/device-snapshots.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('device_snapshots')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.device_snapshots`
- **Modelo ORM:** `DeviceSnapshotModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 20 · **FK salientes:** 4 · **Referencias entrantes:** 0

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
| `brand` | `brand` | string \| null | STRING(100) | No | — | — |
| `model` | `model` | string \| null | STRING(160) | No | — | — |
| `osFamily` | `os_family` | string \| null | STRING(40) | No | — | — |
| `osVersion` | `os_version` | string \| null | STRING(80) | No | — | — |
| `appVersion` | `app_version` | string \| null | STRING(80) | No | — | — |
| `deviceReleaseYear` | `device_release_year` | number \| null | INTEGER | No | — | — |
| `deviceAgeMonths` | `device_age_months` | number \| null | INTEGER | No | — | — |
| `deviceTierSnapshot` | `device_tier_snapshot` | string \| null | STRING(40) | No | — | — |
| `estimatedDeviceValueBsSnapshot` | `estimated_device_value_bs_snapshot` | string \| null | DECIMAL(14, 2) | No | — | — |
| `isRooted` | `is_rooted` | boolean \| null | BOOLEAN | No | — | — |
| `isEmulator` | `is_emulator` | boolean \| null | BOOLEAN | No | — | — |
| `vpnDetected` | `vpn_detected` | boolean \| null | BOOLEAN | No | — | — |
| `screenCount` | `screen_count` | number \| null | INTEGER | No | — | — |
| `capturedAt` | `captured_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



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
| `` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `device_id`, `customer_id`, `session_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/device-snapshots.model.ts`](../../../../src/database/models/device-snapshots.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154057-schema-relationships-part-3-devices-sessions.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
