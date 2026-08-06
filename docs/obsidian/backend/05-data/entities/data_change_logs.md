---
title: "data_change_logs"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Auditoría y calidad"
schema: "audit"
table: "data_change_logs"
orm_model: "DataChangeLogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/audit"
source_files:
  - "src/database/models/data-change-logs.model.ts"
aliases:
  - "DataChangeLogModel"
---
# `audit.data_change_logs`

> [!info] Verificado
> Modelo ORM `DataChangeLogModel` en [`src/database/models/data-change-logs.model.ts`](../../../../src/database/models/data-change-logs.model.ts). Esquema físico `audit` resuelto por `atlasSchemaFor('data_change_logs')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `audit.data_change_logs`
- **Modelo ORM:** `DataChangeLogModel`
- **Dominio:** Auditoría y calidad → [[audit-schema]]
- **Atributos:** 13 · **FK salientes:** 3 · **Referencias entrantes:** 0

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
| `tableName` | `table_name` | string \| null | STRING(120) | No | — | — |
| `recordId` | `record_id` | string \| null | STRING(120) | No | — | — |
| `changeType` | `change_type` | string \| null | STRING(40) | No | — | — |
| `changedByType` | `changed_by_type` | string \| null | STRING(40) | No | — | — |
| `changedByInternalUserId` | `changed_by_internal_user_id` | string \| null | BIGINT | No | FK | — |
| `changedByPlatformUserId` | `changed_by_platform_user_id` | string \| null | BIGINT | No | FK | — |
| `oldValuesHash` | `old_values_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `newValuesHash` | `new_values_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `changeReason` | `change_reason` | string \| null | TEXT | No | — | — |
| `changedAt` | `changed_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 2 de 13 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `old_values_hash`, `new_values_hash`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
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
| `table_name, record_id` | No único | — | btree |
| `` | No único | — | btree |
| `_tenant_id, changed_at DESC, _id DESC` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `changed_by_internal_user_id`, `changed_by_platform_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/data-change-logs.model.ts`](../../../../src/database/models/data-change-logs.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154103-schema-relationships-part-9-audit-quality.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
