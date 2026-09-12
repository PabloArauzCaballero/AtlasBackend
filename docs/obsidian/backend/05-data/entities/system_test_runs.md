---
title: "system_test_runs"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_test_runs"
orm_model: "SystemTestRunModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-test-runs.model.ts"
aliases:
  - "SystemTestRunModel"
---
# `platform_ops.system_test_runs`

> [!info] Verificado
> Modelo ORM `SystemTestRunModel` en [`src/database/models/system-test-runs.model.ts`](../../../../../src/database/models/system-test-runs.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_test_runs')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_test_runs`
- **Modelo ORM:** `SystemTestRunModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 13 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `tenantId` | `_tenant_id` | string \| null | BIGINT | No | — | — |
| `suiteId` | `suite_id` | string | BIGINT | Sí | — | — |
| `environment` | `environment` | string | STRING(40) | Sí | — | — |
| `triggeredBy` | `triggered_by` | string \| null | STRING(80) | No | — | — |
| `status` | `status` | string | STRING(40) | Sí | — | — |
| `startedAt` | `started_at` | Date \| null | DATE | No | — | — |
| `finishedAt` | `finished_at` | Date \| null | DATE | No | — | — |
| `durationMs` | `duration_ms` | number \| null | INTEGER | No | — | — |
| `summary` | `summary` | Record<string, unknown> | JSONB | Sí | — | — |
| `logsUrl` | `logs_url` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| — | — | — | — | — |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `suite_id` | No único | — | btree |
| `status` | No único | — | btree |
| `_created_at DESC` | No único | — | btree |
| `_tenant_id, _created_at DESC` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-test-runs.model.ts`](../../../../../src/database/models/system-test-runs.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
