---
title: "context_sources"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "context_sources"
orm_model: "ContextSourceModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/context-sources.model.ts"
aliases:
  - "ContextSourceModel"
---
# `catalog.context_sources`

> [!info] Verificado
> Modelo ORM `ContextSourceModel` en [`src/database/models/context-sources.model.ts`](../../../../../src/database/models/context-sources.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('context_sources')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.context_sources`
- **Modelo ORM:** `ContextSourceModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 10 · **FK salientes:** 0 · **Referencias entrantes:** 1

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
| `sourceCode` | `source_code` | string \| null | STRING(80) | No | — | — |
| `sourceName` | `source_name` | string \| null | STRING(180) | No | — | — |
| `sourceType` | `source_type` | string \| null | STRING(60) | No | — | — |
| `reliabilityScore` | `reliability_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `refreshFrequency` | `refresh_frequency` | string \| null | STRING(60) | No | — | — |
| `notes` | `notes` | string \| null | TEXT | No | — | — |
| `isActive` | `is_active` | boolean \| null | BOOLEAN | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| — | — | — | — | — |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[context_items]] | `source_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `source_code` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/context-sources.model.ts`](../../../../../src/database/models/context-sources.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
