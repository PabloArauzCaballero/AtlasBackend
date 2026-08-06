---
title: "address_gps_observations"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Clientes e identidad"
schema: "customer"
table: "address_gps_observations"
orm_model: "AddressGpsObservationModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/customer"
source_files:
  - "src/database/models/address-gps-observations.model.ts"
aliases:
  - "AddressGpsObservationModel"
---
# `customer.address_gps_observations`

> [!info] Verificado
> Modelo ORM `AddressGpsObservationModel` en [`src/database/models/address-gps-observations.model.ts`](../../../../src/database/models/address-gps-observations.model.ts). Esquema físico `customer` resuelto por `atlasSchemaFor('address_gps_observations')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `customer.address_gps_observations`
- **Modelo ORM:** `AddressGpsObservationModel`
- **Dominio:** Clientes e identidad → [[customer-schema]]
- **Atributos:** 13 · **FK salientes:** 5 · **Referencias entrantes:** 0

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
| `customerAddressId` | `customer_address_id` | string \| null | BIGINT | No | FK | PII |
| `addressVersionId` | `address_version_id` | string \| null | BIGINT | No | FK | PII |
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `gpsLat` | `gps_lat` | string \| null | DECIMAL(10, 7) | No | — | — |
| `gpsLng` | `gps_lng` | string \| null | DECIMAL(10, 7) | No | — | — |
| `gpsAccuracyMeters` | `gps_accuracy_meters` | string \| null | DECIMAL(8, 2) | No | — | — |
| `matchScoreAgainstDeclaredAddress` | `match_score_against_declared_address` | string \| null | DECIMAL(5, 2) | No | — | PII |
| `distanceToDeclaredMeters` | `distance_to_declared_meters` | string \| null | DECIMAL(12, 2) | No | — | — |
| `capturedAt` | `captured_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 3 de 13 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `customer_address_id`, `address_version_id`, `match_score_against_declared_address`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `customer_address_id` | [[customer_addresses]] | `_id` | Opcional (0..1) | `SET NULL` |
| `address_version_id` | [[customer_address_versions]] | `_id` | Opcional (0..1) | `SET NULL` |
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
> 4 columna(s) FK no encabezan ningún índice: `customer_id`, `customer_address_id`, `address_version_id`, `session_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/address-gps-observations.model.ts`](../../../../src/database/models/address-gps-observations.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154055-schema-relationships-part-1-customers-identity.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
