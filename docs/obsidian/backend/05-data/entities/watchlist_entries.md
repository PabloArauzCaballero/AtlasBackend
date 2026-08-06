---
title: "watchlist_entries"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Gestión de casos y fraude"
schema: "case_management"
table: "watchlist_entries"
orm_model: "WatchlistEntryModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/case_management"
source_files:
  - "src/database/models/watchlist-entries.model.ts"
aliases:
  - "WatchlistEntryModel"
---
# `case_management.watchlist_entries`

> [!info] Verificado
> Modelo ORM `WatchlistEntryModel` en [`src/database/models/watchlist-entries.model.ts`](../../../../src/database/models/watchlist-entries.model.ts). Esquema físico `case_management` resuelto por `atlasSchemaFor('watchlist_entries')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `case_management.watchlist_entries`
- **Modelo ORM:** `WatchlistEntryModel`
- **Dominio:** Gestión de casos y fraude → [[case_management-schema]]
- **Atributos:** 18 · **FK salientes:** 3 · **Referencias entrantes:** 1

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
| `tenantId` | `_tenant_id` | string \| null | BIGINT | No | FK | — |
| `scope` | `scope` | string \| null | STRING(40) | No | — | — |
| `countryCode` | `country_code` | string \| null | STRING(3) | No | — | — |
| `entityType` | `entity_type` | string \| null | STRING(80) | No | — | — |
| `entityHash` | `entity_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `entityLast4` | `entity_last_4` | string \| null | STRING(4) | No | — | PII parcial |
| `reasonCode` | `reason_code` | string \| null | STRING(100) | No | — | — |
| `severity` | `severity` | string \| null | STRING(40) | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `sourceType` | `source_type` | string \| null | STRING(60) | No | — | — |
| `createdByType` | `created_by_type` | string \| null | STRING(40) | No | — | — |
| `createdByInternalUserId` | `created_by_internal_user_id` | string \| null | BIGINT | No | FK | — |
| `createdByPlatformUserId` | `created_by_platform_user_id` | string \| null | BIGINT | No | FK | — |
| `expiresAt` | `expires_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |

> [!warning] Datos sensibles
> 2 de 18 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `entity_hash`, `entity_last_4`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Opcional (0..1) | `SET NULL` |
| `created_by_internal_user_id` | [[internal_users]] | `_id` | Opcional (0..1) | `SET NULL` |
| `created_by_platform_user_id` | [[platform_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[watchlist_matches]] | `watchlist_entry_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | `_deleted = false` | btree |
| `entity_hash` | No único | — | btree |
| `scope, country_code, entity_type` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `created_by_internal_user_id`, `created_by_platform_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/watchlist-entries.model.ts`](../../../../src/database/models/watchlist-entries.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154102-schema-relationships-part-8-fraud-review.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
