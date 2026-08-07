---
title: "on_device_metric_values"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "on_device_metric_values"
orm_model: "OnDeviceMetricValueModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/on-device-metric-values.model.ts"
aliases:
  - "OnDeviceMetricValueModel"
---
# `telemetry.on_device_metric_values`

> [!info] Verificado
> Modelo ORM `OnDeviceMetricValueModel` en [`src/database/models/on-device-metric-values.model.ts`](../../../../../src/database/models/on-device-metric-values.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('on_device_metric_values')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.on_device_metric_values`
- **Modelo ORM:** `OnDeviceMetricValueModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 10 · **FK salientes:** 2 · **Referencias entrantes:** 0

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
| `tenantId` | `_tenant_id` | string | BIGINT | Sí | FK | — |
| `computationRunId` | `computation_run_id` | string \| null | BIGINT | No | FK | — |
| `metricCode` | `metric_code` | string \| null | STRING(120) | No | — | — |
| `valueText` | `value_text` | string \| null | TEXT | No | — | — |
| `valueNumber` | `value_number` | string \| null | DECIMAL(18, 4) | No | — | — |
| `valueBoolean` | `value_boolean` | boolean \| null | BOOLEAN | No | — | — |
| `valueJson` | `value_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `confidenceScore` | `confidence_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `computation_run_id` | [[on_device_computation_runs]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `computation_run_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/on-device-metric-values.model.ts`](../../../../../src/database/models/on-device-metric-values.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154058-schema-relationships-part-4-onboarding-behavior.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
