---
title: "auth_refresh_tokens"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Identidad y acceso"
schema: "iam"
table: "auth_refresh_tokens"
orm_model: "AuthRefreshTokenModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/iam"
source_files:
  - "src/database/models/auth-refresh-tokens.model.ts"
aliases:
  - "AuthRefreshTokenModel"
---
# `iam.auth_refresh_tokens`

> [!info] Verificado
> Modelo ORM `AuthRefreshTokenModel` en [`src/database/models/auth-refresh-tokens.model.ts`](../../../../../src/database/models/auth-refresh-tokens.model.ts). Esquema físico `iam` resuelto por `atlasSchemaFor('auth_refresh_tokens')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `iam.auth_refresh_tokens`
- **Modelo ORM:** `AuthRefreshTokenModel`
- **Dominio:** Identidad y acceso → [[iam-schema]]
- **Atributos:** 13 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `tokenHash` | `token_hash` | string | STRING(128) | Sí | — | PII hasheada |
| `issuedAt` | `issued_at` | Date | DATE | Sí | — | — |
| `expiresAt` | `expires_at` | Date | DATE | Sí | — | — |
| `revokedAt` | `revoked_at` | Date \| null | DATE | No | — | — |
| `revokedReason` | `revoked_reason` | string \| null | STRING(80) | No | — | — |
| `replacedByTokenId` | `replaced_by_token_id` | string \| null | BIGINT | No | — | Credencial |
| `userAgent` | `user_agent` | string \| null | STRING(255) | No | — | — |
| `ipAddress` | `ip_address` | string \| null | STRING(64) | No | — | PII |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 3 de 13 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `token_hash`, `replaced_by_token_id`, `ip_address`. Ver [[05-data/sensitive-data]].

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

- Modelo: [`src/database/models/auth-refresh-tokens.model.ts`](../../../../../src/database/models/auth-refresh-tokens.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
