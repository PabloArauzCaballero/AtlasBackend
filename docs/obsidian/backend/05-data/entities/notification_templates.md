---
title: "notification_templates"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Mensajería y notificaciones"
schema: "messaging"
table: "notification_templates"
orm_model: "NotificationTemplateModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/messaging"
source_files:
  - "src/database/models/notification-templates.model.ts"
aliases:
  - "NotificationTemplateModel"
---
# `messaging.notification_templates`

> [!info] Verificado
> Modelo ORM `NotificationTemplateModel` en [`src/database/models/notification-templates.model.ts`](../../../../src/database/models/notification-templates.model.ts). Esquema físico `messaging` resuelto por `atlasSchemaFor('notification_templates')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `messaging.notification_templates`
- **Modelo ORM:** `NotificationTemplateModel`
- **Dominio:** Mensajería y notificaciones → [[messaging-schema]]
- **Atributos:** 15 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `code` | `code` | string | STRING(160) | Sí | — | — |
| `channel` | `channel` | string | STRING(40) | Sí | — | — |
| `locale` | `locale` | string | STRING(12) | Sí | — | — |
| `titleTemplate` | `title_template` | string \| null | TEXT | No | — | — |
| `subjectTemplate` | `subject_template` | string \| null | TEXT | No | — | — |
| `bodyTemplate` | `body_template` | string | TEXT | Sí | — | — |
| `category` | `category` | string \| null | STRING(60) | No | — | — |
| `icon` | `icon` | string \| null | STRING(60) | No | — | — |
| `payloadSchemaJson` | `payload_schema_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `isActive` | `is_active` | boolean | BOOLEAN | Sí | — | — |
| `version` | `version` | number | INTEGER | Sí | — | — |
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

- Modelo: [`src/database/models/notification-templates.model.ts`](../../../../src/database/models/notification-templates.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
