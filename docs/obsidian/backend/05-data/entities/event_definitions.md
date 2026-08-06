---
title: "event_definitions"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "event_definitions"
orm_model: "EventDefinitionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/event-definitions.model.ts"
aliases:
  - "EventDefinitionModel"
---
# `catalog.event_definitions`

> [!info] Verificado
> Modelo ORM `EventDefinitionModel` en [`src/database/models/event-definitions.model.ts`](../../../../src/database/models/event-definitions.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('event_definitions')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.event_definitions`
- **Modelo ORM:** `EventDefinitionModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 18 · **FK salientes:** 1 · **Referencias entrantes:** 0

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
| `eventCode` | `event_code` | string \| null | STRING(120) | No | — | — |
| `eventName` | `event_name` | string \| null | STRING(180) | No | — | — |
| `eventFamily` | `event_family` | string \| null | STRING(80) | No | — | — |
| `sourcePackage` | `source_package` | string \| null | STRING(120) | No | — | — |
| `targetTablesJson` | `target_tables_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `expectedPayloadSchemaJson` | `expected_payload_schema_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `riskDimension` | `risk_dimension` | string \| null | STRING(60) | No | — | — |
| `buildPhase` | `build_phase` | string \| null | STRING(40) | No | — | — |
| `dataClassificationCode` | `data_classification_code` | string \| null | STRING(80) | No | — | — |
| `retentionPolicyId` | `retention_policy_id` | string \| null | BIGINT | No | FK | — |
| `isHighVolume` | `is_high_volume` | boolean \| null | BOOLEAN | No | — | — |
| `isActive` | `is_active` | boolean \| null | BOOLEAN | No | — | — |
| `ownerTeam` | `owner_team` | string \| null | STRING(80) | No | — | — |
| `domainCode` | `domain_code` | string \| null | STRING(120) | No | — | — |
| `reviewStatus` | `review_status` | string | STRING(40) | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `retention_policy_id` | [[retention_policies]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `event_code` | Único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `retention_policy_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/event-definitions.model.ts`](../../../../src/database/models/event-definitions.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154059-schema-relationships-part-5-catalog-context.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
