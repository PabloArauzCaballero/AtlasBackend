---
title: "user_notification_preferences"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Mensajería y notificaciones"
schema: "messaging"
table: "user_notification_preferences"
orm_model: "UserNotificationPreferenceModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/messaging"
source_files:
  - "src/database/models/user-notification-preferences.model.ts"
aliases:
  - "UserNotificationPreferenceModel"
---
# `messaging.user_notification_preferences`

> [!info] Verificado
> Modelo ORM `UserNotificationPreferenceModel` en [`src/database/models/user-notification-preferences.model.ts`](../../../../src/database/models/user-notification-preferences.model.ts). Esquema físico `messaging` resuelto por `atlasSchemaFor('user_notification_preferences')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `messaging.user_notification_preferences`
- **Modelo ORM:** `UserNotificationPreferenceModel`
- **Dominio:** Mensajería y notificaciones → [[messaging-schema]]
- **Atributos:** 9 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `eventCode` | `event_code` | string | STRING(160) | Sí | — | — |
| `channel` | `channel` | string | STRING(40) | Sí | — | — |
| `isEnabled` | `is_enabled` | boolean | BOOLEAN | Sí | — | — |
| `isRequired` | `is_required` | boolean | BOOLEAN | Sí | — | — |
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
| — | — | — | — |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/user-notification-preferences.model.ts`](../../../../src/database/models/user-notification-preferences.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
