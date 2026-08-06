---
title: "auth_credentials"
type: "data"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Identidad y acceso"
schema: "iam"
table: "auth_credentials"
orm_model: "AuthCredentialModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/iam"
source_files:
  - "src/database/models/auth-credentials.model.ts"
aliases:
  - "AuthCredentialModel"
---
# `iam.auth_credentials`

> [!info] Verificado
> Modelo ORM `AuthCredentialModel` en [`src/database/models/auth-credentials.model.ts`](../../../../src/database/models/auth-credentials.model.ts). Esquema físico `iam` resuelto por `atlasSchemaFor('auth_credentials')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `iam.auth_credentials`
- **Modelo ORM:** `AuthCredentialModel`
- **Dominio:** Identidad y acceso → [[iam-schema]]
- **Atributos:** 14 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `tenantId` | `_tenant_id` | string \| null | BIGINT | No | — | — |
| `actorType` | `actor_type` | string | STRING(40) | Sí | — | — |
| `actorId` | `actor_id` | string | BIGINT | Sí | — | — |
| `passwordHash` | `password_hash` | string | TEXT | Sí | — | PII hasheada |
| `tokenVersion` | `token_version` | number | INTEGER | Sí | — | Credencial |
| `mfaEnabled` | `mfa_enabled` | boolean | BOOLEAN | Sí | — | — |
| `failedLoginAttempts` | `failed_login_attempts` | number | INTEGER | Sí | — | — |
| `lockedUntil` | `locked_until` | Date \| null | DATE | No | — | — |
| `lastLoginAt` | `last_login_at` | Date \| null | DATE | No | — | — |
| `lastLoginIp` | `last_login_ip` | string \| null | STRING(64) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean | BOOLEAN | Sí | — | — |

> [!warning] Datos sensibles
> 2 de 14 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `password_hash`, `token_version`. Ver [[05-data/sensitive-data]].

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

- Modelo: [`src/database/models/auth-credentials.model.ts`](../../../../src/database/models/auth-credentials.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
