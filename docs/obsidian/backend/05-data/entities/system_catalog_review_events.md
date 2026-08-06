---
title: "system_catalog_review_events"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_catalog_review_events"
orm_model: "SystemCatalogReviewEventModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-catalog-review-events.model.ts"
aliases:
  - "SystemCatalogReviewEventModel"
---
# `platform_ops.system_catalog_review_events`

> [!info] Verificado
> Modelo ORM `SystemCatalogReviewEventModel` en [`src/database/models/system-catalog-review-events.model.ts`](../../../../src/database/models/system-catalog-review-events.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_catalog_review_events')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_catalog_review_events`
- **Modelo ORM:** `SystemCatalogReviewEventModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
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
| `id` | `_id` | string | BIGINT | No | PK | — |
| `tenantId` | `_tenant_id` | string \| null | BIGINT | No | — | — |
| `targetType` | `target_type` | string | STRING(80) | Sí | — | — |
| `targetId` | `target_id` | string | BIGINT | Sí | — | — |
| `previousStatus` | `previous_status` | string \| null | STRING(40) | No | — | — |
| `newStatus` | `new_status` | string | STRING(40) | Sí | — | — |
| `previousConfidence` | `previous_confidence` | string \| null | STRING(40) | No | — | — |
| `newConfidence` | `new_confidence` | string \| null | STRING(40) | No | — | — |
| `notes` | `notes` | string \| null | TEXT | No | — | — |
| `actorId` | `actor_id` | string \| null | STRING(120) | No | — | — |
| `actorRole` | `actor_role` | string | STRING(80) | Sí | — | — |
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
| `target_type, target_id, _created_at DESC` | No único | — | btree |
| `_tenant_id, _created_at DESC` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-catalog-review-events.model.ts`](../../../../src/database/models/system-catalog-review-events.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
