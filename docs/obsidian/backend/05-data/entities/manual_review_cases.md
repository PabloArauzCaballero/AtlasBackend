---
title: "manual_review_cases"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Gestión de casos y fraude"
schema: "case_management"
table: "manual_review_cases"
orm_model: "ManualReviewCaseModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/case_management"
source_files:
  - "src/database/models/manual-review-cases.model.ts"
aliases:
  - "ManualReviewCaseModel"
---
# `case_management.manual_review_cases`

> [!info] Verificado
> Modelo ORM `ManualReviewCaseModel` en [`src/database/models/manual-review-cases.model.ts`](../../../../src/database/models/manual-review-cases.model.ts). Esquema físico `case_management` resuelto por `atlasSchemaFor('manual_review_cases')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `case_management.manual_review_cases`
- **Modelo ORM:** `ManualReviewCaseModel`
- **Dominio:** Gestión de casos y fraude → [[case_management-schema]]
- **Atributos:** 17 · **FK salientes:** 5 · **Referencias entrantes:** 3

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
| `tenantId` | `_tenant_id` | string | BIGINT | Sí | FK | — |
| `caseCode` | `case_code` | string \| null | STRING(80) | No | — | — |
| `customerId` | `customer_id` | string \| null | BIGINT | No | FK | — |
| `riskAssessmentRunId` | `risk_assessment_run_id` | string \| null | BIGINT | No | FK | — |
| `fraudCaseId` | `fraud_case_id` | string \| null | BIGINT | No | FK | — |
| `caseType` | `case_type` | string \| null | STRING(80) | No | — | — |
| `priority` | `priority` | string \| null | STRING(40) | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `assignedToInternalUserId` | `assigned_to_internal_user_id` | string \| null | BIGINT | No | FK | — |
| `openedAt` | `opened_at` | Date \| null | DATE | No | — | — |
| `closedAt` | `closed_at` | Date \| null | DATE | No | — | — |
| `resolution` | `resolution` | string \| null | STRING(80) | No | — | — |
| `notes` | `notes` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `risk_assessment_run_id` | [[risk_assessment_runs]] | `_id` | Opcional (0..1) | `SET NULL` |
| `fraud_case_id` | [[fraud_cases]] | `_id` | Opcional (0..1) | `SET NULL` |
| `assigned_to_internal_user_id` | [[internal_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[manual_review_events]] | `manual_review_case_id` | 0..N opcional |
| [[fraud_cases]] | `escalated_from_review_case_id` | 0..N opcional |
| [[watchlist_matches]] | `opened_review_case_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | `_deleted = false` | btree |
| `_tenant_id, case_code` | Único | `_deleted = false` | btree |
| `` | No único | — | btree |
| `assigned_to_internal_user_id, status` | No único | — | btree |
| `_tenant_id, priority, opened_at DESC, _id DESC` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `customer_id`, `risk_assessment_run_id`, `fraud_case_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/manual-review-cases.model.ts`](../../../../src/database/models/manual-review-cases.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154102-schema-relationships-part-8-fraud-review.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
