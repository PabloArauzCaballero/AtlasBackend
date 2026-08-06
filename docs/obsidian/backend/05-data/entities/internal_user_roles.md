---
title: "internal_user_roles"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Identidad y acceso"
schema: "iam"
table: "internal_user_roles"
orm_model: "InternalUserRoleModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/iam"
source_files:
  - "src/database/models/internal-user-roles.model.ts"
aliases:
  - "InternalUserRoleModel"
---
# `iam.internal_user_roles`

> [!info] Verificado
> Modelo ORM `InternalUserRoleModel` en [`src/database/models/internal-user-roles.model.ts`](../../../../src/database/models/internal-user-roles.model.ts). Esquema físico `iam` resuelto por `atlasSchemaFor('internal_user_roles')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `iam.internal_user_roles`
- **Modelo ORM:** `InternalUserRoleModel`
- **Dominio:** Identidad y acceso → [[iam-schema]]
- **Atributos:** 11 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `internalUserId` | `internal_user_id` | string | BIGINT | Sí | — | — |
| `roleId` | `role_id` | string | BIGINT | Sí | — | — |
| `assignedByInternalUserId` | `assigned_by_internal_user_id` | string \| null | BIGINT | No | — | — |
| `assignedAt` | `assigned_at` | Date | DATE | Sí | — | — |
| `revokedAt` | `revoked_at` | Date \| null | DATE | No | — | — |
| `revokedByInternalUserId` | `revoked_by_internal_user_id` | string \| null | BIGINT | No | — | — |
| `revocationReason` | `revocation_reason` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



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
| `_tenant_id, internal_user_id, role_id` | Único | — | btree |
| `_tenant_id, internal_user_id` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/internal-user-roles.model.ts`](../../../../src/database/models/internal-user-roles.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
