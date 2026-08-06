---
title: "workflow_definitions"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "workflow_definitions"
orm_model: "WorkflowDefinitionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/workflow-definitions.model.ts"
aliases:
  - "WorkflowDefinitionModel"
---
# `platform_ops.workflow_definitions`

> [!info] Verificado
> Modelo ORM `WorkflowDefinitionModel` en [`src/database/models/workflow-definitions.model.ts`](../../../../src/database/models/workflow-definitions.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('workflow_definitions')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.workflow_definitions`
- **Modelo ORM:** `WorkflowDefinitionModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 22 · **FK salientes:** 0 · **Referencias entrantes:** 0

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`RIESGO` — la tabla **no** tiene `_tenant_id`: es global a la plataforma o el aislamiento depende de la tabla padre. Verificar antes de exponerla en un endpoint por tenant.

## Borrado lógico

`VERIFICADO` — usa borrado lógico vía `_deleted`. Las lecturas deben excluir `_deleted = true`.

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `workflowCode` | `workflow_code` | string | STRING(80) | Sí | — | — |
| `version` | `version` | string | STRING(20) | Sí | — | — |
| `name` | `name` | string | STRING(180) | Sí | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `processType` | `process_type` | string | STRING(60) | Sí | — | — |
| `ownerDomain` | `owner_domain` | string | STRING(80) | Sí | — | — |
| `status` | `status` | string | STRING(20) | Sí | — | — |
| `isDefault` | `is_default` | boolean | BOOLEAN | Sí | — | — |
| `entryStageCode` | `entry_stage_code` | string \| null | STRING(80) | No | — | — |
| `terminalStageCodes` | `terminal_stage_codes` | string[] | JSONB | Sí | — | — |
| `successCriteria` | `success_criteria_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `failureCriteria` | `failure_criteria_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `metadata` | `metadata_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `source` | `source` | string | STRING(40) | Sí | — | — |
| `effectiveFrom` | `effective_from` | Date \| null | DATE | No | — | — |
| `effectiveUntil` | `effective_until` | Date \| null | DATE | No | — | — |
| `createdBy` | `created_by` | string \| null | STRING(120) | No | — | — |
| `updatedBy` | `updated_by` | string \| null | STRING(120) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date | DATE | Sí | — | — |
| `deleted` | `_deleted` | boolean | BOOLEAN | Sí | — | — |



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
| — | — | — | — |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/workflow-definitions.model.ts`](../../../../src/database/models/workflow-definitions.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
