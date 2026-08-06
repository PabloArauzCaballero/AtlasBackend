---
title: "platform_users"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Identidad y acceso"
schema: "iam"
table: "platform_users"
orm_model: "PlatformUserModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/iam"
source_files:
  - "src/database/models/platform-users.model.ts"
aliases:
  - "PlatformUserModel"
---
# `iam.platform_users`

> [!info] Verificado
> Modelo ORM `PlatformUserModel` en [`src/database/models/platform-users.model.ts`](../../../../src/database/models/platform-users.model.ts). Esquema físico `iam` resuelto por `atlasSchemaFor('platform_users')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `iam.platform_users`
- **Modelo ORM:** `PlatformUserModel`
- **Dominio:** Identidad y acceso → [[iam-schema]]
- **Atributos:** 9 · **FK salientes:** 0 · **Referencias entrantes:** 10

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
| `userCode` | `user_code` | string \| null | STRING(60) | No | — | — |
| `fullName` | `full_name` | string \| null | STRING(180) | No | — | PII |
| `email` | `email` | string \| null | STRING(180) | No | — | PII |
| `roleCode` | `role_code` | string \| null | STRING(80) | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |

> [!warning] Datos sensibles
> 2 de 9 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `full_name`, `email`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| — | — | — | — | — |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[customer_status_events]] | `changed_by_platform_user_id` | 0..N opcional |
| [[context_catalog_versions]] | `created_by_platform_user_id` | 0..N opcional |
| [[context_catalog_versions]] | `approved_by_platform_user_id` | 0..N opcional |
| [[context_staging_items]] | `created_by_platform_user_id` | 0..N opcional |
| [[context_approval_events]] | `decided_by_platform_user_id` | 0..N opcional |
| [[risk_model_versions]] | `approved_by_platform_user_id` | 0..N opcional |
| [[risk_ruleset_versions]] | `approved_by_platform_user_id` | 0..N opcional |
| [[watchlist_entries]] | `created_by_platform_user_id` | 0..N opcional |
| [[data_change_logs]] | `changed_by_platform_user_id` | 0..N opcional |
| [[operational_audit_logs]] | `actor_platform_user_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `user_code` | Único | `_deleted = false` | btree |
| `email` | Único | `_deleted = false` | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/platform-users.model.ts`](../../../../src/database/models/platform-users.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
