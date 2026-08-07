---
title: "system_test_steps"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_test_steps"
orm_model: "SystemTestStepModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-test-steps.model.ts"
aliases:
  - "SystemTestStepModel"
---
# `platform_ops.system_test_steps`

> [!info] Verificado
> Modelo ORM `SystemTestStepModel` en [`src/database/models/system-test-steps.model.ts`](../../../../../src/database/models/system-test-steps.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_test_steps')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_test_steps`
- **Modelo ORM:** `SystemTestStepModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 17 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `suiteId` | `suite_id` | string | BIGINT | Sí | — | — |
| `endpointId` | `endpoint_id` | string \| null | BIGINT | No | — | — |
| `stepOrder` | `step_order` | number | INTEGER | Sí | — | — |
| `name` | `name` | string | STRING(220) | Sí | — | — |
| `inputMode` | `input_mode` | string | STRING(40) | Sí | — | — |
| `method` | `method` | string | STRING(12) | Sí | — | — |
| `pathTemplate` | `path_template` | string | TEXT | Sí | — | — |
| `defaultHeaders` | `default_headers` | Record<string, unknown> | JSONB | Sí | — | — |
| `defaultPayload` | `default_payload` | Record<string, unknown> | JSONB | Sí | — | — |
| `configSchema` | `config_schema` | Record<string, unknown> | JSONB | Sí | — | — |
| `extractors` | `extractors` | Record<string, unknown> | JSONB | Sí | — | — |
| `assertions` | `assertions` | Record<string, unknown> | JSONB | Sí | — | — |
| `continueOnFailure` | `continue_on_failure` | boolean | BOOLEAN | Sí | — | — |
| `cleanupRequired` | `cleanup_required` | boolean | BOOLEAN | Sí | — | — |
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
| `suite_id, step_order` | Único | — | btree |
| `endpoint_id` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-test-steps.model.ts`](../../../../../src/database/models/system-test-steps.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
