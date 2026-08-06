---
title: "workflow_stages"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "workflow_stages"
orm_model: "WorkflowStageModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/workflow-stages.model.ts"
aliases:
  - "WorkflowStageModel"
---
# `platform_ops.workflow_stages`

> [!info] Verificado
> Modelo ORM `WorkflowStageModel` en [`src/database/models/workflow-stages.model.ts`](../../../../src/database/models/workflow-stages.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('workflow_stages')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.workflow_stages`
- **Modelo ORM:** `WorkflowStageModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 20 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `workflowDefinitionId` | `workflow_definition_id` | string | BIGINT | Sí | — | — |
| `parentStageId` | `parent_stage_id` | string \| null | BIGINT | No | — | — |
| `stageCode` | `stage_code` | string | STRING(80) | Sí | — | — |
| `name` | `name` | string | STRING(180) | Sí | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `moduleCode` | `module_code` | string | STRING(80) | Sí | — | — |
| `actorType` | `actor_type` | string | STRING(40) | Sí | — | — |
| `displayOrder` | `display_order` | number | INTEGER | Sí | — | — |
| `isOptional` | `is_optional` | boolean | BOOLEAN | Sí | — | — |
| `isEntryStage` | `is_entry_stage` | boolean | BOOLEAN | Sí | — | — |
| `isTerminalStage` | `is_terminal_stage` | boolean | BOOLEAN | Sí | — | — |
| `allowedRoles` | `allowed_roles_json` | string[] | JSONB | Sí | — | — |
| `requiredStates` | `required_states_json` | string[] | JSONB | Sí | — | — |
| `resultingStates` | `resulting_states_json` | string[] | JSONB | Sí | — | — |
| `completionRule` | `completion_rule_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `metadata` | `metadata_json` | Record<string, unknown> | JSONB | Sí | — | — |
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

- Modelo: [`src/database/models/workflow-stages.model.ts`](../../../../src/database/models/workflow-stages.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
