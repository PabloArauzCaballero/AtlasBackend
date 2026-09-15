---
title: "context_approval_events"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "context_approval_events"
orm_model: "ContextApprovalEventModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/context-approval-events.model.ts"
aliases:
  - "ContextApprovalEventModel"
---
# `catalog.context_approval_events`

> [!info] Verificado
> Modelo ORM `ContextApprovalEventModel` en [`src/database/models/context-approval-events.model.ts`](../../../../../src/database/models/context-approval-events.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('context_approval_events')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.context_approval_events`
- **Modelo ORM:** `ContextApprovalEventModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 8 · **FK salientes:** 3 · **Referencias entrantes:** 0

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
| `stagingItemId` | `staging_item_id` | string \| null | BIGINT | No | FK | — |
| `catalogVersionId` | `catalog_version_id` | string \| null | BIGINT | No | FK | — |
| `eventType` | `event_type` | string \| null | STRING(60) | No | — | — |
| `decidedByPlatformUserId` | `decided_by_platform_user_id` | string \| null | BIGINT | No | FK | — |
| `decidedAt` | `decided_at` | Date \| null | DATE | No | — | — |
| `decisionReason` | `decision_reason` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `staging_item_id` | [[context_staging_items]] | `_id` | Opcional (0..1) | `SET NULL` |
| `catalog_version_id` | [[context_catalog_versions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `decided_by_platform_user_id` | [[platform_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| — | — | — | — |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `staging_item_id`, `catalog_version_id`, `decided_by_platform_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/context-approval-events.model.ts`](../../../../../src/database/models/context-approval-events.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154059-schema-relationships-part-5-catalog-context.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
