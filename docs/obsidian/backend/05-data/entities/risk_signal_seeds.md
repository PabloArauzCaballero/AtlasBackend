---
title: "risk_signal_seeds"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "risk_signal_seeds"
orm_model: "RiskSignalSeedModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/risk-signal-seeds.model.ts"
aliases:
  - "RiskSignalSeedModel"
---
# `risk.risk_signal_seeds`

> [!info] Verificado
> Modelo ORM `RiskSignalSeedModel` en [`src/database/models/risk-signal-seeds.model.ts`](../../../../src/database/models/risk-signal-seeds.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('risk_signal_seeds')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.risk_signal_seeds`
- **Modelo ORM:** `RiskSignalSeedModel`
- **Dominio:** Riesgo y features → [[risk-schema]]
- **Atributos:** 15 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `signalCode` | `signal_code` | string \| null | STRING(120) | No | — | — |
| `signalName` | `signal_name` | string \| null | STRING(180) | No | — | — |
| `signalType` | `signal_type` | string \| null | STRING(60) | No | — | — |
| `sourceEntity` | `source_entity` | string \| null | STRING(120) | No | — | — |
| `targetDefinitionCode` | `target_definition_code` | string \| null | STRING(120) | No | — | — |
| `riskDimension` | `risk_dimension` | string \| null | STRING(60) | No | — | — |
| `buildPhase` | `build_phase` | string \| null | STRING(40) | No | — | — |
| `priority` | `priority` | string \| null | STRING(40) | No | — | — |
| `expectedDirection` | `expected_direction` | string \| null | STRING(40) | No | — | — |
| `exampleValueJson` | `example_value_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `rationale` | `rationale` | string \| null | TEXT | No | — | — |
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
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `signal_code` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/risk-signal-seeds.model.ts`](../../../../src/database/models/risk-signal-seeds.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
