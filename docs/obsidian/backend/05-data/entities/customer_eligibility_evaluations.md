---
title: "customer_eligibility_evaluations"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Clientes e identidad"
schema: "customer"
table: "customer_eligibility_evaluations"
orm_model: "CustomerEligibilityEvaluationModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/customer"
source_files:
  - "src/database/models/customer-eligibility-evaluations.model.ts"
aliases:
  - "CustomerEligibilityEvaluationModel"
---
# `customer.customer_eligibility_evaluations`

> [!info] Verificado
> Modelo ORM `CustomerEligibilityEvaluationModel` en [`src/database/models/customer-eligibility-evaluations.model.ts`](../../../../src/database/models/customer-eligibility-evaluations.model.ts). Esquema físico `customer` resuelto por `atlasSchemaFor('customer_eligibility_evaluations')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `customer.customer_eligibility_evaluations`
- **Modelo ORM:** `CustomerEligibilityEvaluationModel`
- **Dominio:** Clientes e identidad → [[customer-schema]]
- **Atributos:** 15 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `tenantId` | `_tenant_id` | string | BIGINT | Sí | — | — |
| `customerId` | `customer_id` | string | BIGINT | Sí | — | — |
| `eligible` | `eligible` | boolean | BOOLEAN | Sí | — | — |
| `lifecycleStatus` | `lifecycle_status` | string | STRING(40) | Sí | — | — |
| `ruleVersion` | `rule_version` | string | STRING(40) | Sí | — | — |
| `blockersJson` | `blockers_json` | unknown | JSONB | Sí | — | — |
| `factsHash` | `facts_hash` | string | STRING(128) | Sí | — | PII hasheada |
| `evaluatedByType` | `evaluated_by_type` | string | STRING(40) | Sí | — | — |
| `evaluatedByInternalUserId` | `evaluated_by_internal_user_id` | string \| null | BIGINT | No | — | — |
| `decisionSource` | `decision_source` | string | STRING(40) | Sí | — | — |
| `reasonCode` | `reason_code` | string \| null | STRING(120) | No | — | — |
| `notes` | `notes` | string \| null | TEXT | No | — | — |
| `evaluatedAt` | `evaluated_at` | Date | DATE | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 15 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `facts_hash`. Ver [[05-data/sensitive-data]].

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

- Modelo: [`src/database/models/customer-eligibility-evaluations.model.ts`](../../../../src/database/models/customer-eligibility-evaluations.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
