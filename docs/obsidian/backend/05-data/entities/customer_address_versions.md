---
title: "customer_address_versions"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Clientes e identidad"
schema: "customer"
table: "customer_address_versions"
orm_model: "CustomerAddressVersionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/customer"
source_files:
  - "src/database/models/customer-address-versions.model.ts"
aliases:
  - "CustomerAddressVersionModel"
---
# `customer.customer_address_versions`

> [!info] Verificado
> Modelo ORM `CustomerAddressVersionModel` en [`src/database/models/customer-address-versions.model.ts`](../../../../src/database/models/customer-address-versions.model.ts). Esquema físico `customer` resuelto por `atlasSchemaFor('customer_address_versions')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `customer.customer_address_versions`
- **Modelo ORM:** `CustomerAddressVersionModel`
- **Dominio:** Clientes e identidad → [[customer-schema]]
- **Atributos:** 19 · **FK salientes:** 4 · **Referencias entrantes:** 3

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
| `customerAddressId` | `customer_address_id` | string \| null | BIGINT | No | FK | PII |
| `declaredAddressText` | `declared_address_text` | string \| null | TEXT | No | — | PII |
| `normalizedAddressText` | `normalized_address_text` | string \| null | TEXT | No | — | PII |
| `declaredZoneName` | `declared_zone_name` | string \| null | STRING(120) | No | — | — |
| `city` | `city` | string \| null | STRING(120) | No | — | — |
| `department` | `department` | string \| null | STRING(80) | No | — | — |
| `countryCode` | `country_code` | string \| null | STRING(3) | No | — | — |
| `geoZoneCodeSnapshot` | `geo_zone_code_snapshot` | string \| null | STRING(80) | No | — | — |
| `geoZoneNameSnapshot` | `geo_zone_name_snapshot` | string \| null | STRING(180) | No | — | — |
| `evidenceId` | `evidence_id` | string \| null | BIGINT | No | FK | — |
| `sourceType` | `source_type` | string \| null | STRING(60) | No | — | — |
| `verificationStatus` | `verification_status` | string \| null | STRING(40) | No | — | — |
| `verifiabilityBand` | `verifiability_band` | string \| null | STRING(40) | No | — | — |
| `validFrom` | `valid_from` | Date \| null | DATE | No | — | — |
| `validUntil` | `valid_until` | Date \| null | DATE | No | — | — |
| `supersedesVersionId` | `supersedes_version_id` | string \| null | BIGINT | No | FK | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 3 de 19 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `customer_address_id`, `declared_address_text`, `normalized_address_text`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_address_id` | [[customer_addresses]] | `_id` | Opcional (0..1) | `SET NULL` |
| `evidence_id` | [[evidence_documents]] | `_id` | Opcional (0..1) | `SET NULL` |
| `supersedes_version_id` | [[customer_address_versions]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[customer_addresses]] | `current_version_id` | 0..N opcional |
| [[customer_address_versions]] | `supersedes_version_id` | 0..N opcional |
| [[address_gps_observations]] | `address_version_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `customer_address_id, valid_until` | No único | `valid_until IS NULL` | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `evidence_id`, `supersedes_version_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-address-versions.model.ts`](../../../../src/database/models/customer-address-versions.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154055-schema-relationships-part-1-customers-identity.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
