---
title: "context_risk_mappings"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Catálogo y contexto"
schema: "catalog"
table: "context_risk_mappings"
orm_model: "ContextRiskMappingModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/catalog"
source_files:
  - "src/database/models/context-risk-mappings.model.ts"
aliases:
  - "ContextRiskMappingModel"
---
# `catalog.context_risk_mappings`

> [!info] Verificado
> Modelo ORM `ContextRiskMappingModel` en [`src/database/models/context-risk-mappings.model.ts`](../../../../src/database/models/context-risk-mappings.model.ts). Esquema físico `catalog` resuelto por `atlasSchemaFor('context_risk_mappings')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `catalog.context_risk_mappings`
- **Modelo ORM:** `ContextRiskMappingModel`
- **Dominio:** Catálogo y contexto → [[catalog-schema]]
- **Atributos:** 13 · **FK salientes:** 1 · **Referencias entrantes:** 0

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
| `contextItemId` | `context_item_id` | string \| null | BIGINT | No | FK | — |
| `riskDimension` | `risk_dimension` | string \| null | STRING(60) | No | — | — |
| `riskBand` | `risk_band` | string \| null | STRING(40) | No | — | — |
| `scorePointsSuggested` | `score_points_suggested` | string \| null | DECIMAL(8, 2) | No | — | — |
| `reasonCode` | `reason_code` | string \| null | STRING(100) | No | — | — |
| `explanation` | `explanation` | string \| null | TEXT | No | — | — |
| `modelUsage` | `model_usage` | string \| null | STRING(80) | No | — | — |
| `validFrom` | `valid_from` | string \| null | DATEONLY | No | — | — |
| `validUntil` | `valid_until` | string \| null | DATEONLY | No | — | — |
| `allowedForDirectAdverseCreditAction` | `allowed_for_direct_adverse_credit_action` | boolean | BOOLEAN | Sí | — | — |
| `requiresCalibration` | `requires_calibration` | boolean | BOOLEAN | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `context_item_id` | [[context_items]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| — | — | — | — |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `context_item_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/context-risk-mappings.model.ts`](../../../../src/database/models/context-risk-mappings.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154059-schema-relationships-part-5-catalog-context.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
