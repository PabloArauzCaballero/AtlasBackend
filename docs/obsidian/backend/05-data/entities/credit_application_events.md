---
title: "credit_application_events"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Crédito"
schema: "credit"
table: "credit_application_events"
orm_model: "CreditApplicationEventModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/credit"
source_files:
  - "src/database/models/credit-application-events.model.ts"
aliases:
  - "CreditApplicationEventModel"
---
# `credit.credit_application_events`

> [!info] Verificado
> Modelo ORM `CreditApplicationEventModel` en [`src/database/models/credit-application-events.model.ts`](../../../../src/database/models/credit-application-events.model.ts). Esquema físico `credit` resuelto por `atlasSchemaFor('credit_application_events')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `credit.credit_application_events`
- **Modelo ORM:** `CreditApplicationEventModel`
- **Dominio:** Crédito → [[credit-schema]]
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
| `tenantId` | `_tenant_id` | string | BIGINT | Sí | — | — |
| `creditApplicationId` | `credit_application_id` | string | BIGINT | Sí | — | — |
| `eventType` | `event_type` | string | STRING(40) | Sí | — | — |
| `previousStatus` | `previous_status` | string \| null | STRING(30) | No | — | — |
| `newStatus` | `new_status` | string \| null | STRING(30) | No | — | — |
| `actorType` | `actor_type` | string | STRING(40) | Sí | — | — |
| `actorInternalUserId` | `actor_internal_user_id` | string \| null | BIGINT | No | — | — |
| `reasonCode` | `reason_code` | string \| null | STRING(120) | No | — | — |
| `payloadJson` | `payload_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `notes` | `notes` | string \| null | TEXT | No | — | — |
| `happenedAt` | `happened_at` | Date | DATE | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



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

- Modelo: [`src/database/models/credit-application-events.model.ts`](../../../../src/database/models/credit-application-events.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
