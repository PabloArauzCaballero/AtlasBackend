---
title: "notification_messages"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Mensajería y notificaciones"
schema: "messaging"
table: "notification_messages"
orm_model: "NotificationMessageModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/messaging"
source_files:
  - "src/database/models/notification-messages.model.ts"
aliases:
  - "NotificationMessageModel"
---
# `messaging.notification_messages`

> [!info] Verificado
> Modelo ORM `NotificationMessageModel` en [`src/database/models/notification-messages.model.ts`](../../../../src/database/models/notification-messages.model.ts). Esquema físico `messaging` resuelto por `atlasSchemaFor('notification_messages')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `messaging.notification_messages`
- **Modelo ORM:** `NotificationMessageModel`
- **Dominio:** Mensajería y notificaciones → [[messaging-schema]]
- **Atributos:** 28 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `outboxEventId` | `outbox_event_id` | string \| null | BIGINT | No | — | — |
| `recipientType` | `recipient_type` | string | STRING(40) | Sí | — | — |
| `recipientId` | `recipient_id` | string | STRING(120) | Sí | — | — |
| `channel` | `channel` | string | STRING(40) | Sí | — | — |
| `templateCode` | `template_code` | string \| null | STRING(160) | No | — | — |
| `category` | `category` | string \| null | STRING(60) | No | — | — |
| `icon` | `icon` | string \| null | STRING(60) | No | — | — |
| `subject` | `subject` | string \| null | TEXT | No | — | — |
| `title` | `title` | string \| null | TEXT | No | — | — |
| `body` | `body` | string | TEXT | Sí | — | — |
| `payloadJson` | `payload_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `deliveryTargetsJson` | `delivery_targets_json` | Array<Record<string, unknown>> \| null | JSONB | No | — | — |
| `status` | `status` | string | STRING(40) | Sí | — | — |
| `priority` | `priority` | number | INTEGER | Sí | — | — |
| `scheduledAt` | `scheduled_at` | Date \| null | DATE | No | — | — |
| `queuedAt` | `queued_at` | Date \| null | DATE | No | — | — |
| `sentAt` | `sent_at` | Date \| null | DATE | No | — | — |
| `deliveredAt` | `delivered_at` | Date \| null | DATE | No | — | — |
| `readAt` | `read_at` | Date \| null | DATE | No | — | — |
| `failedAt` | `failed_at` | Date \| null | DATE | No | — | — |
| `cancelledAt` | `cancelled_at` | Date \| null | DATE | No | — | — |
| `idempotencyKey` | `idempotency_key` | string \| null | STRING(180) | No | — | — |
| `correlationId` | `correlation_id` | string \| null | STRING(120) | No | — | — |
| `causationId` | `causation_id` | string \| null | STRING(120) | No | — | — |
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
| `_tenant_id, idempotency_key` | Único | — | btree |
| `category` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/notification-messages.model.ts`](../../../../src/database/models/notification-messages.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
