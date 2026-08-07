---
title: "global_device_fingerprints"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "global_device_fingerprints"
orm_model: "GlobalDeviceFingerprintModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/global-device-fingerprints.model.ts"
aliases:
  - "GlobalDeviceFingerprintModel"
---
# `telemetry.global_device_fingerprints`

> [!info] Verificado
> Modelo ORM `GlobalDeviceFingerprintModel` en [`src/database/models/global-device-fingerprints.model.ts`](../../../../../src/database/models/global-device-fingerprints.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('global_device_fingerprints')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.global_device_fingerprints`
- **Modelo ORM:** `GlobalDeviceFingerprintModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 9 · **FK salientes:** 0 · **Referencias entrantes:** 1

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`RIESGO` — la tabla **no** tiene `_tenant_id`: es global a la plataforma o el aislamiento depende de la tabla padre. Verificar antes de exponerla en un endpoint por tenant.

## Borrado lógico

`INFERIDO` — sin columna `_deleted`: el borrado es físico o la entidad es de solo-inserción (evento/log).

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `deviceFingerprint` | `device_fingerprint` | string \| null | STRING(180) | No | — | — |
| `fingerprintVersion` | `fingerprint_version` | string \| null | STRING(60) | No | — | — |
| `globalFirstSeenAt` | `global_first_seen_at` | Date \| null | DATE | No | — | — |
| `globalLastSeenAt` | `global_last_seen_at` | Date \| null | DATE | No | — | — |
| `globalReuseCount` | `global_reuse_count` | number \| null | INTEGER | No | — | — |
| `globalRiskStatus` | `global_risk_status` | string \| null | STRING(40) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| — | — | — | — | — |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[devices]] | `global_device_fingerprint_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `device_fingerprint` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/global-device-fingerprints.model.ts`](../../../../../src/database/models/global-device-fingerprints.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
