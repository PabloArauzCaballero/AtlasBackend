---
title: "system_endpoint_tool_requirements"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_endpoint_tool_requirements"
orm_model: "SystemEndpointToolRequirementModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-endpoint-tool-requirements.model.ts"
aliases:
  - "SystemEndpointToolRequirementModel"
---
# `platform_ops.system_endpoint_tool_requirements`

> [!info] Verificado
> Modelo ORM `SystemEndpointToolRequirementModel` en [`src/database/models/system-endpoint-tool-requirements.model.ts`](../../../../../src/database/models/system-endpoint-tool-requirements.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_endpoint_tool_requirements')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_endpoint_tool_requirements`
- **Modelo ORM:** `SystemEndpointToolRequirementModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
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
| `endpointId` | `endpoint_id` | string | BIGINT | Sí | — | — |
| `toolId` | `tool_id` | string | BIGINT | Sí | — | — |
| `usageType` | `usage_type` | string | STRING(60) | Sí | — | — |
| `isRequired` | `is_required` | boolean | BOOLEAN | Sí | — | — |
| `failureImpact` | `failure_impact` | string | STRING(20) | Sí | — | — |
| `fallbackStrategy` | `fallback_strategy` | string \| null | TEXT | No | — | — |
| `requiresMock` | `requires_mock` | boolean | BOOLEAN | Sí | — | — |
| `requiresStressTest` | `requires_stress_test` | boolean | BOOLEAN | Sí | — | — |
| `notes` | `notes` | string \| null | TEXT | No | — | — |
| `detectedFrom` | `detected_from` | string | STRING(80) | Sí | — | — |
| `confidenceLevel` | `confidence_level` | string | STRING(20) | Sí | — | — |
| `reviewStatus` | `review_status` | string | STRING(40) | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date | DATE | Sí | — | — |



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
| `endpoint_id, tool_id, usage_type` | Único | — | btree |
| `endpoint_id` | No único | — | btree |
| `tool_id` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-endpoint-tool-requirements.model.ts`](../../../../../src/database/models/system-endpoint-tool-requirements.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
