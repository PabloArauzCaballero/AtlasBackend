---
title: "credit_applications"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Crédito"
schema: "credit"
table: "credit_applications"
orm_model: "CreditApplicationModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/credit"
source_files:
  - "src/database/models/credit-applications.model.ts"
aliases:
  - "CreditApplicationModel"
---
# `credit.credit_applications`

> [!info] Verificado
> Modelo ORM `CreditApplicationModel` en [`src/database/models/credit-applications.model.ts`](../../../../src/database/models/credit-applications.model.ts). Esquema físico `credit` resuelto por `atlasSchemaFor('credit_applications')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `credit.credit_applications`
- **Modelo ORM:** `CreditApplicationModel`
- **Dominio:** Crédito → [[credit-schema]]
- **Atributos:** 21 · **FK salientes:** 0 · **Referencias entrantes:** 0

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`VERIFICADO` — la tabla incluye `_tenant_id`, por lo que toda consulta debe filtrar por tenant. Ver [[08-security/authorization]].

## Borrado lógico

`VERIFICADO` — usa borrado lógico vía `_deleted`. Las lecturas deben excluir `_deleted = true`.

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `tenantId` | `_tenant_id` | string | BIGINT | Sí | — | — |
| `applicationCode` | `application_code` | string | STRING(40) | Sí | — | — |
| `customerId` | `customer_id` | string | BIGINT | Sí | — | — |
| `creditProductId` | `credit_product_id` | string | BIGINT | Sí | — | — |
| `requestedAmount` | `requested_amount` | string | DECIMAL(18, 2) | Sí | — | — |
| `requestedTermMonths` | `requested_term_months` | number | INTEGER | Sí | — | — |
| `currencyCode` | `currency_code` | string | STRING(3) | Sí | — | — |
| `purposeCode` | `purpose_code` | string \| null | STRING(80) | No | — | — |
| `status` | `status` | string | STRING(30) | Sí | — | — |
| `eligibilityEvaluationId` | `eligibility_evaluation_id` | string \| null | BIGINT | No | — | — |
| `eligibilitySnapshotJson` | `eligibility_snapshot_json` | unknown | JSONB | Sí | — | — |
| `riskAssessmentRunId` | `risk_assessment_run_id` | string \| null | BIGINT | No | — | — |
| `decisionReasonCode` | `decision_reason_code` | string \| null | STRING(120) | No | — | — |
| `decidedAt` | `decided_at` | Date \| null | DATE | No | — | — |
| `decidedByInternalUserId` | `decided_by_internal_user_id` | string \| null | BIGINT | No | — | — |
| `idempotencyKeyHash` | `idempotency_key_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `submittedAt` | `submitted_at` | Date | DATE | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean | BOOLEAN | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 21 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `idempotency_key_hash`. Ver [[05-data/sensitive-data]].

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

- Modelo: [`src/database/models/credit-applications.model.ts`](../../../../src/database/models/credit-applications.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
