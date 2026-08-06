---
title: "fraud_cases"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Gestión de casos y fraude"
schema: "case_management"
table: "fraud_cases"
orm_model: "FraudCaseModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/case_management"
source_files:
  - "src/database/models/fraud-cases.model.ts"
aliases:
  - "FraudCaseModel"
---
# `case_management.fraud_cases`

> [!info] Verificado
> Modelo ORM `FraudCaseModel` en [`src/database/models/fraud-cases.model.ts`](../../../../src/database/models/fraud-cases.model.ts). Esquema físico `case_management` resuelto por `atlasSchemaFor('fraud_cases')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `case_management.fraud_cases`
- **Modelo ORM:** `FraudCaseModel`
- **Dominio:** Gestión de casos y fraude → [[case_management-schema]]
- **Atributos:** 20 · **FK salientes:** 5 · **Referencias entrantes:** 3

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
| `primaryDeviceId` | `primary_device_id` | string \| null | BIGINT | No | FK | — |
| `escalatedFromReviewCaseId` | `escalated_from_review_case_id` | string \| null | BIGINT | No | FK | — |
| `caseStatus` | `case_status` | string \| null | STRING(40) | No | — | — |
| `severity` | `severity` | string \| null | STRING(40) | No | — | — |
| `patternDetected` | `pattern_detected` | string \| null | STRING(120) | No | — | — |
| `linkedCustomersJson` | `linked_customers_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `linkedSessionsJson` | `linked_sessions_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `linkedDevicesJson` | `linked_devices_json` | Record<string, unknown> \| null | JSONB | No | — | — |
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
| `primary_device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |
| `escalated_from_review_case_id` | [[manual_review_cases]] | `_id` | Opcional (0..1) | `SET NULL` |
| `assigned_to_internal_user_id` | [[internal_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[manual_review_cases]] | `fraud_case_id` | 0..N opcional |
| [[fraud_case_events]] | `fraud_case_id` | 0..N opcional |
| [[watchlist_matches]] | `opened_fraud_case_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | `_deleted = false` | btree |
| `_tenant_id, case_code` | Único | `_deleted = false` | btree |
| `` | No único | — | btree |
| `customer_id` | No único | `_deleted = false` | btree |
| `_tenant_id, opened_at DESC, _id DESC` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `primary_device_id`, `escalated_from_review_case_id`, `assigned_to_internal_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/fraud-cases.model.ts`](../../../../src/database/models/fraud-cases.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154102-schema-relationships-part-8-fraud-review.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
