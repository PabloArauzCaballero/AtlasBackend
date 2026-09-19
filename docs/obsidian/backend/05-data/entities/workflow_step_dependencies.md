---
title: "workflow_step_dependencies"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "workflow_step_dependencies"
orm_model: "WorkflowStepDependencyModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/workflow-step-dependencies.model.ts"
aliases:
  - "WorkflowStepDependencyModel"
---
# `platform_ops.workflow_step_dependencies`

> [!info] Verificado
> Modelo ORM `WorkflowStepDependencyModel` en [`src/database/models/workflow-step-dependencies.model.ts`](../../../../../src/database/models/workflow-step-dependencies.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('workflow_step_dependencies')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.workflow_step_dependencies`
- **Modelo ORM:** `WorkflowStepDependencyModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 8 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `stepId` | `step_id` | string | BIGINT | Sí | — | — |
| `dependsOnStepId` | `depends_on_step_id` | string | BIGINT | Sí | — | — |
| `dependencyType` | `dependency_type` | string | STRING(40) | Sí | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
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

- Modelo: [`src/database/models/workflow-step-dependencies.model.ts`](../../../../../src/database/models/workflow-step-dependencies.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
