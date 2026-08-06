---
title: "device_tokens"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Mensajería y notificaciones"
schema: "messaging"
table: "device_tokens"
orm_model: "DeviceTokenModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/messaging"
source_files:
  - "src/database/models/device-tokens.model.ts"
aliases:
  - "DeviceTokenModel"
---
# `messaging.device_tokens`

> [!info] Verificado
> Modelo ORM `DeviceTokenModel` en [`src/database/models/device-tokens.model.ts`](../../../../src/database/models/device-tokens.model.ts). Esquema físico `messaging` resuelto por `atlasSchemaFor('device_tokens')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `messaging.device_tokens`
- **Modelo ORM:** `DeviceTokenModel`
- **Dominio:** Mensajería y notificaciones → [[messaging-schema]]
- **Atributos:** 12 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `customerId` | `customer_id` | string | BIGINT | Sí | — | — |
| `platform` | `platform` | string | STRING(40) | Sí | — | — |
| `tokenHash` | `token_hash` | string | STRING(128) | Sí | — | PII hasheada |
| `tokenEncrypted` | `token_encrypted` | string \| null | TEXT | No | — | PII cifrada |
| `tokenLast4` | `token_last4` | string \| null | STRING(12) | No | — | PII parcial |
| `deviceId` | `device_id` | string \| null | STRING(180) | No | — | — |
| `isActive` | `is_active` | boolean | BOOLEAN | Sí | — | — |
| `lastSeenAt` | `last_seen_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |

> [!warning] Datos sensibles
> 3 de 12 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `token_hash`, `token_encrypted`, `token_last4`. Ver [[05-data/sensitive-data]].

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

- Modelo: [`src/database/models/device-tokens.model.ts`](../../../../src/database/models/device-tokens.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
