---
title: "idempotency_keys"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "idempotency_keys"
orm_model: "IdempotencyKeyModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/idempotency-keys.model.ts"
aliases:
  - "IdempotencyKeyModel"
---
# `platform_ops.idempotency_keys`

> [!info] Verificado
> Modelo ORM `IdempotencyKeyModel` en [`src/database/models/idempotency-keys.model.ts`](../../../../src/database/models/idempotency-keys.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('idempotency_keys')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.idempotency_keys`
- **Modelo ORM:** `IdempotencyKeyModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 14 · **FK salientes:** 0 · **Referencias entrantes:** 0

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`RIESGO` — la tabla **no** tiene `_tenant_id`: es global a la plataforma o el aislamiento depende de la tabla padre. Verificar antes de exponerla en un endpoint por tenant.

## Borrado lógico

`INFERIDO` — sin columna `_deleted`: el borrado es físico o la entidad es de solo-inserción (evento/log).

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `tenantScope` | `tenant_scope` | string | STRING(80) | Sí | — | — |
| `actorType` | `actor_type` | string \| null | STRING(40) | No | — | — |
| `actorId` | `actor_id` | string \| null | STRING(120) | No | — | — |
| `idempotencyKey` | `idempotency_key` | string | STRING(160) | Sí | — | — |
| `scope` | `scope` | string | STRING(220) | Sí | — | — |
| `requestHash` | `request_hash` | string | STRING(128) | Sí | — | PII hasheada |
| `status` | `status` | string | STRING(40) | Sí | — | — |
| `responseStatus` | `response_status` | number \| null | INTEGER | No | — | — |
| `responseBodyJson` | `response_body_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `lockedUntil` | `locked_until` | Date \| null | DATE | No | — | — |
| `completedAt` | `completed_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |

> [!warning] Datos sensibles
> 1 de 14 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `request_hash`. Ver [[05-data/sensitive-data]].

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

- Modelo: [`src/database/models/idempotency-keys.model.ts`](../../../../src/database/models/idempotency-keys.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
