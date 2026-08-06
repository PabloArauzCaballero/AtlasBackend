---
title: "devices"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "devices"
orm_model: "DeviceModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/devices.model.ts"
aliases:
  - "DeviceModel"
---
# `telemetry.devices`

> [!info] Verificado
> Modelo ORM `DeviceModel` en [`src/database/models/devices.model.ts`](../../../../src/database/models/devices.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('devices')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.devices`
- **Modelo ORM:** `DeviceModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 12 · **FK salientes:** 2 · **Referencias entrantes:** 19

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`VERIFICADO` — la tabla incluye `_tenant_id`, por lo que toda consulta debe filtrar por tenant. Ver [[08-security/authorization]].

## Borrado lógico

`VERIFICADO` — usa borrado lógico vía `_deleted`. Las lecturas deben excluir `_deleted = true`.

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `tenantId` | `_tenant_id` | string | BIGINT | Sí | FK | — |
| `globalDeviceFingerprintId` | `global_device_fingerprint_id` | string \| null | BIGINT | No | FK | — |
| `deviceFingerprint` | `device_fingerprint` | string \| null | STRING(180) | No | — | — |
| `fingerprintVersion` | `fingerprint_version` | string \| null | STRING(60) | No | — | — |
| `firstSeenAt` | `first_seen_at` | Date \| null | DATE | No | — | — |
| `lastSeenAt` | `last_seen_at` | Date \| null | DATE | No | — | — |
| `tenantReuseCount` | `tenant_reuse_count` | number \| null | INTEGER | No | — | — |
| `riskStatus` | `risk_status` | string \| null | STRING(40) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `global_device_fingerprint_id` | [[global_device_fingerprints]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[customer_device_links]] | `device_id` | 0..N opcional |
| [[device_snapshots]] | `device_id` | 0..N opcional |
| [[device_risk_events]] | `device_id` | 0..N opcional |
| [[sim_observations]] | `device_id` | 0..N opcional |
| [[customer_sessions]] | `device_id` | 0..N opcional |
| [[auth_events]] | `device_id` | 0..N opcional |
| [[ip_reputation_observations]] | `device_id` | 0..N opcional |
| [[customer_action_logs]] | `device_id` | 0..N opcional |
| [[customer_activity_summaries]] | `first_device_id` | 0..N opcional |
| [[customer_activity_summaries]] | `usual_device_id` | 0..N opcional |
| [[on_device_computation_runs]] | `device_id` | 0..N opcional |
| [[customer_observations]] | `device_id` | 0..N opcional |
| [[feature_computation_runs]] | `device_id` | 0..N opcional |
| [[feature_values]] | `device_id` | 0..N opcional |
| [[feature_snapshots]] | `device_id` | 0..N opcional |
| [[risk_assessment_runs]] | `device_id` | 0..N opcional |
| [[risk_assessment_results]] | `device_id` | 0..N opcional |
| [[fraud_cases]] | `primary_device_id` | 0..N opcional |
| [[watchlist_matches]] | `device_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | `_deleted = false` | btree |
| `_tenant_id, device_fingerprint` | Único | `_deleted = false` | btree |
| `global_device_fingerprint_id` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/devices.model.ts`](../../../../src/database/models/devices.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154057-schema-relationships-part-3-devices-sessions.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
