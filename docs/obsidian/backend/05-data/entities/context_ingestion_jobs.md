---
title: "context_ingestion_jobs"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "context_ingestion_jobs"
orm_model: "ContextIngestionJobModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/context-ingestion-jobs.model.ts"
aliases:
  - "ContextIngestionJobModel"
---
# `catalog.context_ingestion_jobs`

> [!info] Verificado
> Modelo ORM `ContextIngestionJobModel` en [`src/database/models/context-ingestion-jobs.model.ts`](../../../../src/database/models/context-ingestion-jobs.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('context_ingestion_jobs')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.context_ingestion_jobs`
- **Modelo ORM:** `ContextIngestionJobModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 11 · **FK salientes:** 0 · **Referencias entrantes:** 1

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
| `jobCode` | `job_code` | string \| null | STRING(100) | No | — | — |
| `sourceType` | `source_type` | string \| null | STRING(60) | No | — | — |
| `sourceName` | `source_name` | string \| null | STRING(160) | No | — | — |
| `triggeredByType` | `triggered_by_type` | string \| null | STRING(40) | No | — | — |
| `triggeredByPlatformUserId` | `triggered_by_platform_user_id` | string \| null | BIGINT | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `startedAt` | `started_at` | Date \| null | DATE | No | — | — |
| `finishedAt` | `finished_at` | Date \| null | DATE | No | — | — |
| `summaryJson` | `summary_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| — | — | — | — | — |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[context_staging_items]] | `ingestion_job_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| — | — | — | — |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/context-ingestion-jobs.model.ts`](../../../../src/database/models/context-ingestion-jobs.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
