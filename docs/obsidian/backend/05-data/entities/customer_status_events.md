---
title: "customer_status_events"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Clientes e identidad"
schema: "customer"
table: "customer_status_events"
orm_model: "CustomerStatusEventModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/customer"
source_files:
  - "src/database/models/customer-status-events.model.ts"
aliases:
  - "CustomerStatusEventModel"
---
# `customer.customer_status_events`

> [!info] Verificado
> Modelo ORM `CustomerStatusEventModel` en [`src/database/models/customer-status-events.model.ts`](../../../../src/database/models/customer-status-events.model.ts). Esquema físico `customer` resuelto por `atlasSchemaFor('customer_status_events')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `customer.customer_status_events`
- **Modelo ORM:** `CustomerStatusEventModel`
- **Dominio:** Clientes e identidad → [[customer-schema]]
- **Atributos:** 12 · **FK salientes:** 4 · **Referencias entrantes:** 0

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
| `previousStatus` | `previous_status` | string \| null | STRING(40) | No | — | — |
| `newStatus` | `new_status` | string \| null | STRING(40) | No | — | — |
| `reasonCode` | `reason_code` | string \| null | STRING(80) | No | — | — |
| `changedByType` | `changed_by_type` | string \| null | STRING(40) | No | — | — |
| `changedByInternalUserId` | `changed_by_internal_user_id` | string \| null | BIGINT | No | FK | — |
| `changedByPlatformUserId` | `changed_by_platform_user_id` | string \| null | BIGINT | No | FK | — |
| `happenedAt` | `happened_at` | Date \| null | DATE | No | — | — |
| `notes` | `notes` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `changed_by_internal_user_id` | [[internal_users]] | `_id` | Opcional (0..1) | `SET NULL` |
| `changed_by_platform_user_id` | [[platform_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `_tenant_id, happened_at DESC, _id DESC` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `customer_id`, `changed_by_internal_user_id`, `changed_by_platform_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-status-events.model.ts`](../../../../src/database/models/customer-status-events.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154055-schema-relationships-part-1-customers-identity.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
