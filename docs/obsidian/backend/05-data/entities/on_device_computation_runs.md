---
title: "on_device_computation_runs"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "on_device_computation_runs"
orm_model: "OnDeviceComputationRunModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/on-device-computation-runs.model.ts"
aliases:
  - "OnDeviceComputationRunModel"
---
# `telemetry.on_device_computation_runs`

> [!info] Verificado
> Modelo ORM `OnDeviceComputationRunModel` en [`src/database/models/on-device-computation-runs.model.ts`](../../../../../src/database/models/on-device-computation-runs.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('on_device_computation_runs')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.on_device_computation_runs`
- **Modelo ORM:** `OnDeviceComputationRunModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 16 · **FK salientes:** 6 · **Referencias entrantes:** 1

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
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `onboardingFlowId` | `onboarding_flow_id` | string \| null | BIGINT | No | FK | — |
| `consentId` | `consent_id` | string \| null | BIGINT | No | FK | — |
| `algorithmCode` | `algorithm_code` | string \| null | STRING(100) | No | — | — |
| `algorithmVersion` | `algorithm_version` | string \| null | STRING(80) | No | — | — |
| `computationStatus` | `computation_status` | string \| null | STRING(40) | No | — | — |
| `rawContactsStored` | `raw_contacts_stored` | boolean \| null | BOOLEAN | No | — | — |
| `rawSmsStored` | `raw_sms_stored` | boolean \| null | BOOLEAN | No | — | — |
| `integrityHash` | `integrity_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `computedAtDevice` | `computed_at_device` | Date \| null | DATE | No | — | — |
| `receivedAtServer` | `received_at_server` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 16 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `integrity_hash`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |
| `session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `onboarding_flow_id` | [[onboarding_flows]] | `_id` | Opcional (0..1) | `SET NULL` |
| `consent_id` | [[customer_consents]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[on_device_metric_values]] | `computation_run_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 5 columna(s) FK no encabezan ningún índice: `customer_id`, `device_id`, `session_id`, `onboarding_flow_id`, `consent_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

- `ck_on_device_no_raw_contacts_or_sms`: `(raw_contacts_stored IS FALSE AND raw_sms_stored IS FALSE)` — origen: `20260626154058-schema-relationships-part-4-onboarding-behavior.ts`

## Evidencia y referencias

- Modelo: [`src/database/models/on-device-computation-runs.model.ts`](../../../../../src/database/models/on-device-computation-runs.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154058-schema-relationships-part-4-onboarding-behavior.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
