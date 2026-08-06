---
title: "system_test_suites"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_test_suites"
orm_model: "SystemTestSuiteModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-test-suites.model.ts"
aliases:
  - "SystemTestSuiteModel"
---
# `platform_ops.system_test_suites`

> [!info] Verificado
> Modelo ORM `SystemTestSuiteModel` en [`src/database/models/system-test-suites.model.ts`](../../../../src/database/models/system-test-suites.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_test_suites')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_test_suites`
- **Modelo ORM:** `SystemTestSuiteModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 15 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `code` | `code` | string | STRING(180) | Sí | — | — |
| `name` | `name` | string | STRING(220) | Sí | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `module` | `module` | string | STRING(120) | Sí | — | — |
| `suiteType` | `suite_type` | string | STRING(40) | Sí | — | — |
| `executionMode` | `execution_mode` | string | STRING(40) | Sí | — | — |
| `environmentScope` | `environment_scope` | string[] | JSONB | Sí | — | — |
| `isEnabled` | `is_enabled` | boolean | BOOLEAN | Sí | — | — |
| `requiresSeedData` | `requires_seed_data` | boolean | BOOLEAN | Sí | — | — |
| `isSafeForProduction` | `is_safe_for_production` | boolean | BOOLEAN | Sí | — | — |
| `requiresDestructivePermission` | `requires_destructive_permission` | boolean | BOOLEAN | Sí | — | — |
| `createdBy` | `created_by` | string \| null | STRING(80) | No | — | — |
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
| `module` | No único | — | btree |
| `suite_type` | No único | — | btree |
| `is_enabled` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-test-suites.model.ts`](../../../../src/database/models/system-test-suites.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
