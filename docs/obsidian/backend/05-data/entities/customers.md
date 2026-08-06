---
title: "customers"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Clientes e identidad"
schema: "customer"
table: "customers"
orm_model: "CustomerModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/customer"
source_files:
  - "src/database/models/customers.model.ts"
aliases:
  - "CustomerModel"
---
# `customer.customers`

> [!info] Verificado
> Modelo ORM `CustomerModel` en [`src/database/models/customers.model.ts`](../../../../src/database/models/customers.model.ts). Esquema físico `customer` resuelto por `atlasSchemaFor('customers')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `customer.customers`
- **Modelo ORM:** `CustomerModel`
- **Dominio:** Clientes e identidad → [[customer-schema]]
- **Atributos:** 18 · **FK salientes:** 2 · **Referencias entrantes:** 35

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
| `customerCode` | `customer_code` | string \| null | STRING(40) | No | — | — |
| `customerUuid` | `customer_uuid` | string \| null | UUID | No | — | — |
| `primaryPhoneHash` | `primary_phone_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `primaryPhoneEncrypted` | `primary_phone_encrypted` | string \| null | BLOB | No | — | PII cifrada |
| `primaryPhoneLast4` | `primary_phone_last_4` | string \| null | STRING(4) | No | — | PII parcial |
| `primaryEmailHash` | `primary_email_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `primaryEmailEncrypted` | `primary_email_encrypted` | string \| null | BLOB | No | — | PII cifrada |
| `primaryEmailDomain` | `primary_email_domain` | string \| null | STRING(120) | No | — | PII |
| `lifecycleStatus` | `lifecycle_status` | string | STRING(40) | Sí | — | — |
| `creditEligibilityStatus` | `credit_eligibility_status` | string \| null | STRING(40) | No | — | — |
| `eligibilityEvaluatedAt` | `eligibility_evaluated_at` | Date \| null | DATE | No | — | — |
| `currentProfileVersionId` | `current_profile_version_id` | string \| null | BIGINT | No | FK | — |
| `closedAt` | `closed_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |

> [!warning] Datos sensibles
> 6 de 18 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `primary_phone_hash`, `primary_phone_encrypted`, `primary_phone_last_4`, `primary_email_hash`, `primary_email_encrypted`, `primary_email_domain`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `current_profile_version_id` | [[customer_profile_versions]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[data_provider_requests]] | `customer_id` | 0..N opcional |
| [[customer_status_events]] | `customer_id` | 0..N opcional |
| [[customer_profile_versions]] | `customer_id` | 0..N opcional |
| [[customer_identity_documents]] | `customer_id` | 0..N opcional |
| [[identity_verification_attempts]] | `customer_id` | 0..N opcional |
| [[customer_contact_methods]] | `customer_id` | 0..N opcional |
| [[customer_addresses]] | `customer_id` | 0..N opcional |
| [[address_gps_observations]] | `customer_id` | 0..N opcional |
| [[customer_reference_contacts]] | `customer_id` | 0..N opcional |
| [[customer_consents]] | `customer_id` | 0..N opcional |
| [[data_subject_requests]] | `customer_id` | 0..N opcional |
| [[evidence_documents]] | `customer_id` | 0..N opcional |
| [[customer_device_links]] | `customer_id` | 0..N opcional |
| [[device_snapshots]] | `customer_id` | 0..N opcional |
| [[sim_observations]] | `customer_id` | 0..N opcional |
| [[customer_sessions]] | `customer_id` | 0..N opcional |
| [[auth_events]] | `customer_id` | 0..N opcional |
| [[ip_reputation_observations]] | `customer_id` | 0..N opcional |
| [[customer_action_logs]] | `customer_id` | 0..N opcional |
| [[customer_activity_summaries]] | `customer_id` | 1..N obligatoria |
| [[onboarding_flows]] | `customer_id` | 0..N opcional |
| [[permission_events]] | `customer_id` | 0..N opcional |
| [[onboarding_behavior_summaries]] | `customer_id` | 0..N opcional |
| [[on_device_computation_runs]] | `customer_id` | 0..N opcional |
| [[customer_observations]] | `customer_id` | 0..N opcional |
| [[customer_attribute_values]] | `customer_id` | 0..N opcional |
| [[customer_context_enrichments]] | `customer_id` | 0..N opcional |
| [[feature_computation_runs]] | `customer_id` | 0..N opcional |
| [[feature_values]] | `customer_id` | 0..N opcional |
| [[feature_snapshots]] | `customer_id` | 0..N opcional |
| [[risk_assessment_runs]] | `customer_id` | 0..N opcional |
| [[risk_assessment_results]] | `customer_id` | 0..N opcional |
| [[manual_review_cases]] | `customer_id` | 0..N opcional |
| [[fraud_cases]] | `customer_id` | 0..N opcional |
| [[watchlist_matches]] | `customer_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | `_deleted = false` | btree |
| `_tenant_id, customer_code` | Único | `_deleted = false` | btree |
| `customer_uuid` | Único | — | btree |
| `_tenant_id, primary_phone_hash` | Único | `_deleted = false` | btree |
| `primary_email_hash` | No único | `_deleted = false` | btree |
| `"_tenant_id", "primary_email_hash"` | Único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `current_profile_version_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customers.model.ts`](../../../../src/database/models/customers.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154055-schema-relationships-part-1-customers-identity.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
