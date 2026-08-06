---
title: "credit_products"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Crédito"
schema: "credit"
table: "credit_products"
orm_model: "CreditProductModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/credit"
source_files:
  - "src/database/models/credit-products.model.ts"
aliases:
  - "CreditProductModel"
---
# `credit.credit_products`

> [!info] Verificado
> Modelo ORM `CreditProductModel` en [`src/database/models/credit-products.model.ts`](../../../../src/database/models/credit-products.model.ts). Esquema físico `credit` resuelto por `atlasSchemaFor('credit_products')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `credit.credit_products`
- **Modelo ORM:** `CreditProductModel`
- **Dominio:** Crédito → [[credit-schema]]
- **Atributos:** 20 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `productCode` | `product_code` | string | STRING(60) | Sí | — | — |
| `productName` | `product_name` | string | STRING(180) | Sí | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `currencyCode` | `currency_code` | string | STRING(3) | Sí | — | — |
| `minAmount` | `min_amount` | string | DECIMAL(18, 2) | Sí | — | — |
| `maxAmount` | `max_amount` | string | DECIMAL(18, 2) | Sí | — | — |
| `minTermMonths` | `min_term_months` | number | INTEGER | Sí | — | — |
| `maxTermMonths` | `max_term_months` | number | INTEGER | Sí | — | — |
| `annualInterestRate` | `annual_interest_rate` | string \| null | DECIMAL(7, 4) | No | — | — |
| `minMonthlyIncome` | `min_monthly_income` | string \| null | DECIMAL(18, 2) | No | — | — |
| `requiresManualReview` | `requires_manual_review` | boolean | BOOLEAN | Sí | — | — |
| `status` | `status` | string | STRING(20) | Sí | — | — |
| `effectiveFrom` | `effective_from` | Date \| null | DATE | No | — | — |
| `effectiveUntil` | `effective_until` | Date \| null | DATE | No | — | — |
| `createdByInternalUserId` | `created_by_internal_user_id` | string \| null | BIGINT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
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

- Modelo: [`src/database/models/credit-products.model.ts`](../../../../src/database/models/credit-products.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
