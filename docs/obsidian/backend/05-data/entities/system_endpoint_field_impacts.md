---
title: "system_endpoint_field_impacts"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_endpoint_field_impacts"
orm_model: "SystemEndpointFieldImpactModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-endpoint-field-impacts.model.ts"
aliases:
  - "SystemEndpointFieldImpactModel"
---
# `platform_ops.system_endpoint_field_impacts`

> [!info] Verificado
> Modelo ORM `SystemEndpointFieldImpactModel` en [`src/database/models/system-endpoint-field-impacts.model.ts`](../../../../src/database/models/system-endpoint-field-impacts.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_endpoint_field_impacts')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_endpoint_field_impacts`
- **Modelo ORM:** `SystemEndpointFieldImpactModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 16 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `dataEntityId` | `data_entity_id` | string | BIGINT | Sí | — | — |
| `fieldName` | `field_name` | string | STRING(180) | Sí | — | — |
| `fieldOperation` | `field_operation` | string | STRING(40) | Sí | — | — |
| `isRequiredInput` | `is_required_input` | boolean | BOOLEAN | Sí | — | — |
| `isGenerated` | `is_generated` | boolean | BOOLEAN | Sí | — | — |
| `isSensitive` | `is_sensitive` | boolean | BOOLEAN | Sí | — | — |
| `isMlCandidate` | `is_ml_candidate` | boolean | BOOLEAN | Sí | — | — |
| `mlFeatureGroup` | `ml_feature_group` | string \| null | STRING(120) | No | — | — |
| `validationRule` | `validation_rule` | Record<string, unknown> | JSONB | Sí | — | — |
| `notes` | `notes` | string \| null | TEXT | No | — | — |
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
| `endpoint_id, data_entity_id, field_name, field_operation` | Único | — | btree |
| `endpoint_id` | No único | — | btree |
| `data_entity_id` | No único | — | btree |
| `is_ml_candidate` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-endpoint-field-impacts.model.ts`](../../../../src/database/models/system-endpoint-field-impacts.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
