---
title: "notification_deliveries"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Mensajería y notificaciones"
schema: "messaging"
table: "notification_deliveries"
orm_model: "NotificationDeliveryModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/messaging"
source_files:
  - "src/database/models/notification-deliveries.model.ts"
aliases:
  - "NotificationDeliveryModel"
---
# `messaging.notification_deliveries`

> [!info] Verificado
> Modelo ORM `NotificationDeliveryModel` en [`src/database/models/notification-deliveries.model.ts`](../../../../../src/database/models/notification-deliveries.model.ts). Esquema físico `messaging` resuelto por `atlasSchemaFor('notification_deliveries')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `messaging.notification_deliveries`
- **Modelo ORM:** `NotificationDeliveryModel`
- **Dominio:** Mensajería y notificaciones → [[messaging-schema]]
- **Atributos:** 16 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `notificationMessageId` | `notification_message_id` | string | BIGINT | Sí | — | — |
| `channel` | `channel` | string | STRING(40) | Sí | — | — |
| `provider` | `provider` | string | STRING(80) | Sí | — | — |
| `providerMessageId` | `provider_message_id` | string \| null | STRING(180) | No | — | — |
| `status` | `status` | string | STRING(40) | Sí | — | — |
| `attemptNumber` | `attempt_number` | number | INTEGER | Sí | — | — |
| `errorCode` | `error_code` | string \| null | STRING(120) | No | — | — |
| `errorMessage` | `error_message` | string \| null | TEXT | No | — | — |
| `requestPayloadJson` | `request_payload_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `responsePayloadJson` | `response_payload_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `sentAt` | `sent_at` | Date \| null | DATE | No | — | — |
| `deliveredAt` | `delivered_at` | Date \| null | DATE | No | — | — |
| `failedAt` | `failed_at` | Date \| null | DATE | No | — | — |
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
| `notification_message_id` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/notification-deliveries.model.ts`](../../../../../src/database/models/notification-deliveries.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
