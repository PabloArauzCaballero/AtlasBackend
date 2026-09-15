---
title: "outbox_events"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "outbox_events"
orm_model: "OutboxEventModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/outbox-events.model.ts"
aliases:
  - "OutboxEventModel"
---
# `platform_ops.outbox_events`

> [!info] Verificado
> Modelo ORM `OutboxEventModel` en [`src/database/models/outbox-events.model.ts`](../../../../../src/database/models/outbox-events.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('outbox_events')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.outbox_events`
- **Modelo ORM:** `OutboxEventModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 27 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `aggregateType` | `aggregate_type` | string | STRING(120) | Sí | — | — |
| `aggregateId` | `aggregate_id` | string \| null | STRING(120) | No | — | — |
| `eventCode` | `event_code` | string | STRING(160) | Sí | — | — |
| `eventPayloadJson` | `event_payload_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `eventFamily` | `event_family` | string \| null | STRING(80) | No | — | — |
| `eventVersion` | `event_version` | number \| null | INTEGER | No | — | — |
| `metadataJson` | `metadata_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `status` | `status` | string | STRING(40) | Sí | — | — |
| `priority` | `priority` | number \| null | INTEGER | No | — | — |
| `attempts` | `attempts` | number | INTEGER | Sí | — | — |
| `maxAttempts` | `max_attempts` | number \| null | INTEGER | No | — | — |
| `lockedAt` | `locked_at` | Date \| null | DATE | No | — | — |
| `lockedBy` | `locked_by` | string \| null | STRING(120) | No | — | — |
| `availableAt` | `available_at` | Date \| null | DATE | No | — | — |
| `processedAt` | `processed_at` | Date \| null | DATE | No | — | — |
| `failedAt` | `failed_at` | Date \| null | DATE | No | — | — |
| `errorCode` | `error_code` | string \| null | STRING(120) | No | — | — |
| `lastError` | `last_error` | string \| null | TEXT | No | — | — |
| `correlationId` | `correlation_id` | string \| null | STRING(120) | No | — | — |
| `idempotencyKey` | `idempotency_key` | string \| null | STRING(180) | No | — | — |
| `causationId` | `causation_id` | string \| null | STRING(120) | No | — | — |
| `sourceModule` | `source_module` | string \| null | STRING(120) | No | — | — |
| `sourceAction` | `source_action` | string \| null | STRING(120) | No | — | — |
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
| `_tenant_id, event_code, idempotency_key` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/outbox-events.model.ts`](../../../../../src/database/models/outbox-events.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
