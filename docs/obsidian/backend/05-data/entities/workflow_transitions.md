---
title: "workflow_transitions"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "workflow_transitions"
orm_model: "WorkflowTransitionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/workflow-transitions.model.ts"
aliases:
  - "WorkflowTransitionModel"
---
# `platform_ops.workflow_transitions`

> [!info] Verificado
> Modelo ORM `WorkflowTransitionModel` en [`src/database/models/workflow-transitions.model.ts`](../../../../src/database/models/workflow-transitions.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('workflow_transitions')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.workflow_transitions`
- **Modelo ORM:** `WorkflowTransitionModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 12 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `workflowDefinitionId` | `workflow_definition_id` | string | BIGINT | Sí | — | — |
| `transitionCode` | `transition_code` | string | STRING(140) | Sí | — | — |
| `fromStepId` | `from_step_id` | string \| null | BIGINT | No | — | — |
| `toStepId` | `to_step_id` | string \| null | BIGINT | No | — | — |
| `conditionType` | `condition_type` | string | STRING(40) | Sí | — | — |
| `conditionExpression` | `condition_expression_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `displayOrder` | `display_order` | number | INTEGER | Sí | — | — |
| `isDefaultPath` | `is_default_path` | boolean | BOOLEAN | Sí | — | — |
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
| — | — | — | — |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/workflow-transitions.model.ts`](../../../../src/database/models/workflow-transitions.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
