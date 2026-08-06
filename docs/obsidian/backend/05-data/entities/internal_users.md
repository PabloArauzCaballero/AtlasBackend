---
title: "internal_users"
type: "data"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Identidad y acceso"
schema: "iam"
table: "internal_users"
orm_model: "InternalUserModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/iam"
source_files:
  - "src/database/models/internal-users.model.ts"
aliases:
  - "InternalUserModel"
---
# `iam.internal_users`

> [!info] Verificado
> Modelo ORM `InternalUserModel` en [`src/database/models/internal-users.model.ts`](../../../../src/database/models/internal-users.model.ts). Esquema físico `iam` resuelto por `atlasSchemaFor('internal_users')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `iam.internal_users`
- **Modelo ORM:** `InternalUserModel`
- **Dominio:** Identidad y acceso → [[iam-schema]]
- **Atributos:** 18 · **FK salientes:** 1 · **Referencias entrantes:** 12

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
| `userCode` | `user_code` | string \| null | STRING(60) | No | — | — |
| `fullName` | `full_name` | string \| null | STRING(180) | No | — | PII |
| `email` | `email` | string \| null | STRING(180) | No | — | PII |
| `roleCode` | `role_code` | string \| null | STRING(80) | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `department` | `department` | string \| null | STRING(40) | No | — | — |
| `jobTitle` | `job_title` | string \| null | STRING(120) | No | — | — |
| `lastLoginAt` | `last_login_at` | Date \| null | DATE | No | — | — |
| `passwordChangedAt` | `password_changed_at` | Date \| null | DATE | No | — | Credencial |
| `mustChangePassword` | `must_change_password` | boolean | BOOLEAN | Sí | — | Credencial |
| `mfaEnabled` | `mfa_enabled` | boolean | BOOLEAN | Sí | — | — |
| `createdByInternalUserId` | `created_by_internal_user_id` | string \| null | BIGINT | No | — | — |
| `updatedByInternalUserId` | `updated_by_internal_user_id` | string \| null | BIGINT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |

> [!warning] Datos sensibles
> 4 de 18 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `full_name`, `email`, `password_changed_at`, `must_change_password`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[customer_status_events]] | `changed_by_internal_user_id` | 0..N opcional |
| [[identity_verification_attempts]] | `manual_reviewed_by` | 0..N opcional |
| [[consent_documents]] | `published_by_internal_user_id` | 0..N opcional |
| [[data_subject_requests]] | `handled_by` | 0..N opcional |
| [[evidence_reviews]] | `reviewed_by` | 0..N opcional |
| [[manual_review_cases]] | `assigned_to_internal_user_id` | 0..N opcional |
| [[manual_review_events]] | `actor_internal_user_id` | 0..N opcional |
| [[fraud_cases]] | `assigned_to_internal_user_id` | 0..N opcional |
| [[fraud_case_events]] | `actor_internal_user_id` | 0..N opcional |
| [[watchlist_entries]] | `created_by_internal_user_id` | 0..N opcional |
| [[data_change_logs]] | `changed_by_internal_user_id` | 0..N opcional |
| [[operational_audit_logs]] | `actor_internal_user_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | `_deleted = false` | btree |
| `_tenant_id, user_code` | Único | `_deleted = false` | btree |
| `_tenant_id, lower(email` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/internal-users.model.ts`](../../../../src/database/models/internal-users.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154054-schema-relationships-part-0-platform-core.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
