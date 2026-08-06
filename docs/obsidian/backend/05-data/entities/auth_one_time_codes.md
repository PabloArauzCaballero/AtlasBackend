---
title: "auth_one_time_codes"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Identidad y acceso"
schema: "iam"
table: "auth_one_time_codes"
orm_model: "AuthOneTimeCodeModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/iam"
source_files:
  - "src/database/models/auth-one-time-codes.model.ts"
aliases:
  - "AuthOneTimeCodeModel"
---
# `iam.auth_one_time_codes`

> [!info] Verificado
> Modelo ORM `AuthOneTimeCodeModel` en [`src/database/models/auth-one-time-codes.model.ts`](../../../../src/database/models/auth-one-time-codes.model.ts). Esquema físico `iam` resuelto por `atlasSchemaFor('auth_one_time_codes')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `iam.auth_one_time_codes`
- **Modelo ORM:** `AuthOneTimeCodeModel`
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
| `tenantId` | `_tenant_id` | string \| null | BIGINT | No | — | — |
| `actorType` | `actor_type` | string | STRING(40) | Sí | — | — |
| `actorId` | `actor_id` | string | BIGINT | Sí | — | — |
| `purpose` | `purpose` | string | STRING(40) | Sí | — | — |
| `codeHash` | `code_hash` | string | STRING(128) | Sí | — | PII hasheada |
| `challengeHash` | `challenge_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `expiresAt` | `expires_at` | Date | DATE | Sí | — | — |
| `consumedAt` | `consumed_at` | Date \| null | DATE | No | — | — |
| `attempts` | `attempts` | number | INTEGER | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 2 de 11 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `code_hash`, `challenge_hash`. Ver [[05-data/sensitive-data]].

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
| `"challenge_hash"` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/auth-one-time-codes.model.ts`](../../../../src/database/models/auth-one-time-codes.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
