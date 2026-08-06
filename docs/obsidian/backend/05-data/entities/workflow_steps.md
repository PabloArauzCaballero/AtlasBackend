---
title: "workflow_steps"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "workflow_steps"
orm_model: "WorkflowStepModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/workflow-steps.model.ts"
aliases:
  - "WorkflowStepModel"
---
# `platform_ops.workflow_steps`

> [!info] Verificado
> Modelo ORM `WorkflowStepModel` en [`src/database/models/workflow-steps.model.ts`](../../../../src/database/models/workflow-steps.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('workflow_steps')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.workflow_steps`
- **Modelo ORM:** `WorkflowStepModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 32 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `workflowStageId` | `workflow_stage_id` | string | BIGINT | Sí | — | — |
| `stepCode` | `step_code` | string | STRING(120) | Sí | — | — |
| `name` | `name` | string | STRING(200) | Sí | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `endpointCode` | `endpoint_code` | string | STRING(180) | Sí | — | — |
| `httpMethod` | `http_method` | string | STRING(10) | Sí | — | — |
| `routePath` | `route_path` | string | TEXT | Sí | — | — |
| `executionOrder` | `execution_order` | number | INTEGER | Sí | — | — |
| `isMandatory` | `is_mandatory` | boolean | BOOLEAN | Sí | — | — |
| `isRepeatable` | `is_repeatable` | boolean | BOOLEAN | Sí | — | — |
| `requiresIdempotencyKey` | `requires_idempotency_key` | boolean | BOOLEAN | Sí | — | — |
| `requiresAuth` | `requires_auth` | boolean | BOOLEAN | Sí | — | — |
| `isFlowEntry` | `is_flow_entry` | boolean | BOOLEAN | Sí | — | — |
| `isFlowExit` | `is_flow_exit` | boolean | BOOLEAN | Sí | — | — |
| `allowedRoles` | `allowed_roles_json` | string[] | JSONB | Sí | — | — |
| `requiredStates` | `required_states_json` | string[] | JSONB | Sí | — | — |
| `resultingStates` | `resulting_states_json` | string[] | JSONB | Sí | — | — |
| `inputContract` | `input_contract_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `outputContract` | `output_contract_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `validationRules` | `validation_rules_json` | unknown[] | JSONB | Sí | — | — |
| `possibleErrors` | `possible_errors_json` | unknown[] | JSONB | Sí | — | — |
| `retryStrategy` | `retry_strategy_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `producesEvents` | `produces_events_json` | string[] | JSONB | Sí | — | — |
| `consumesEvents` | `consumes_events_json` | string[] | JSONB | Sí | — | — |
| `successCriteria` | `success_criteria_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `failureCriteria` | `failure_criteria_json` | Record<string, unknown> | JSONB | Sí | — | — |
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

- Modelo: [`src/database/models/workflow-steps.model.ts`](../../../../src/database/models/workflow-steps.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
