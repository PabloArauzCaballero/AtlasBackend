---
title: "watchlist_matches"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Gestión de casos y fraude"
schema: "case_management"
table: "watchlist_matches"
orm_model: "WatchlistMatchModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/case_management"
source_files:
  - "src/database/models/watchlist-matches.model.ts"
aliases:
  - "WatchlistMatchModel"
---
# `case_management.watchlist_matches`

> [!info] Verificado
> Modelo ORM `WatchlistMatchModel` en [`src/database/models/watchlist-matches.model.ts`](../../../../../src/database/models/watchlist-matches.model.ts). Esquema físico `case_management` resuelto por `atlasSchemaFor('watchlist_matches')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `case_management.watchlist_matches`
- **Modelo ORM:** `WatchlistMatchModel`
- **Dominio:** Gestión de casos y fraude → [[case_management-schema]]
- **Atributos:** 14 · **FK salientes:** 7 · **Referencias entrantes:** 0

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
| `watchlistEntryId` | `watchlist_entry_id` | string \| null | BIGINT | No | FK | — |
| `customerId` | `customer_id` | string \| null | BIGINT | No | FK | — |
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `deviceId` | `device_id` | string \| null | BIGINT | No | FK | — |
| `matchedEntityType` | `matched_entity_type` | string \| null | STRING(80) | No | — | — |
| `matchedValueHash` | `matched_value_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `matchMethod` | `match_method` | string \| null | STRING(40) | No | — | — |
| `matchConfidence` | `match_confidence` | string \| null | DECIMAL(5, 2) | No | — | — |
| `openedReviewCaseId` | `opened_review_case_id` | string \| null | BIGINT | No | FK | — |
| `openedFraudCaseId` | `opened_fraud_case_id` | string \| null | BIGINT | No | FK | — |
| `matchedAt` | `matched_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 14 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `matched_value_hash`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `watchlist_entry_id` | [[watchlist_entries]] | `_id` | Opcional (0..1) | `SET NULL` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |
| `opened_review_case_id` | [[manual_review_cases]] | `_id` | Opcional (0..1) | `SET NULL` |
| `opened_fraud_case_id` | [[fraud_cases]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `` | No único | — | btree |
| `watchlist_entry_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 5 columna(s) FK no encabezan ningún índice: `customer_id`, `session_id`, `device_id`, `opened_review_case_id`, `opened_fraud_case_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/watchlist-matches.model.ts`](../../../../../src/database/models/watchlist-matches.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154102-schema-relationships-part-8-fraud-review.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
