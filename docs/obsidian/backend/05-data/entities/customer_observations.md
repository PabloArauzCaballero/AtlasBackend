---
title: "customer_observations"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "customer_observations"
orm_model: "CustomerObservationModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/customer-observations.model.ts"
aliases:
  - "CustomerObservationModel"
---
# `catalog.customer_observations`

> [!info] Verificado
> Modelo ORM `CustomerObservationModel` en [`src/database/models/customer-observations.model.ts`](../../../../src/database/models/customer-observations.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('customer_observations')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.customer_observations`
- **Modelo ORM:** `CustomerObservationModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 21 · **FK salientes:** 6 · **Referencias entrantes:** 1

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
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `deviceId` | `device_id` | string \| null | BIGINT | No | FK | — |
| `observationCode` | `observation_code` | string \| null | STRING(120) | No | — | — |
| `valueText` | `value_text` | string \| null | TEXT | No | — | — |
| `valueNumber` | `value_number` | string \| null | DECIMAL(18, 4) | No | — | — |
| `valueBoolean` | `value_boolean` | boolean \| null | BOOLEAN | No | — | — |
| `valueJson` | `value_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `sourceType` | `source_type` | string \| null | STRING(80) | No | — | — |
| `sourceProviderId` | `source_provider_id` | string \| null | BIGINT | No | FK | — |
| `evidenceId` | `evidence_id` | string \| null | BIGINT | No | FK | — |
| `confidenceScore` | `confidence_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `verificationStatus` | `verification_status` | string \| null | STRING(40) | No | — | — |
| `capturedAt` | `captured_at` | Date \| null | DATE | No | — | — |
| `validFrom` | `valid_from` | Date \| null | DATE | No | — | — |
| `validUntil` | `valid_until` | Date \| null | DATE | No | — | — |
| `derivationMethod` | `derivation_method` | string \| null | STRING(120) | No | — | — |
| `derivationVersion` | `derivation_version` | string \| null | STRING(80) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |
| `source_provider_id` | [[data_providers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `evidence_id` | [[evidence_documents]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[customer_context_enrichments]] | `observation_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `` | No único | — | btree |
| `` | No único | — | btree |
| `value_json` | No único | — | gin |

> [!warning] FK sin índice dedicado
> 5 columna(s) FK no encabezan ningún índice: `customer_id`, `session_id`, `device_id`, `source_provider_id`, `evidence_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-observations.model.ts`](../../../../src/database/models/customer-observations.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154059-schema-relationships-part-5-catalog-context.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
