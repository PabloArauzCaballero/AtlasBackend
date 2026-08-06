---
title: "internal_roles"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Identidad y acceso"
schema: "iam"
table: "internal_roles"
orm_model: "InternalRoleModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/iam"
source_files:
  - "src/database/models/internal-roles.model.ts"
aliases:
  - "InternalRoleModel"
---
# `iam.internal_roles`

> [!info] Verificado
> Modelo ORM `InternalRoleModel` en [`src/database/models/internal-roles.model.ts`](../../../../src/database/models/internal-roles.model.ts). Esquema físico `iam` resuelto por `atlasSchemaFor('internal_roles')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `iam.internal_roles`
- **Modelo ORM:** `InternalRoleModel`
- **Dominio:** Identidad y acceso → [[iam-schema]]
- **Atributos:** 11 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `roleCode` | `role_code` | string | STRING(80) | Sí | — | — |
| `roleName` | `role_name` | string | STRING(140) | Sí | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `department` | `department` | string \| null | STRING(40) | No | — | — |
| `legacyRoleCode` | `legacy_role_code` | string | STRING(80) | Sí | — | — |
| `isSystemRole` | `is_system_role` | boolean | BOOLEAN | Sí | — | — |
| `status` | `status` | string | STRING(40) | Sí | — | — |
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
| `role_code` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/internal-roles.model.ts`](../../../../src/database/models/internal-roles.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
