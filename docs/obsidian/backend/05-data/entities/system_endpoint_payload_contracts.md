---
title: "system_endpoint_payload_contracts"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_endpoint_payload_contracts"
orm_model: "SystemEndpointPayloadContractModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-endpoint-payload-contracts.model.ts"
aliases:
  - "SystemEndpointPayloadContractModel"
---
# `platform_ops.system_endpoint_payload_contracts`

> [!info] Verificado
> Modelo ORM `SystemEndpointPayloadContractModel` en [`src/database/models/system-endpoint-payload-contracts.model.ts`](../../../../src/database/models/system-endpoint-payload-contracts.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_endpoint_payload_contracts')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_endpoint_payload_contracts`
- **Modelo ORM:** `SystemEndpointPayloadContractModel`
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
| `contractType` | `contract_type` | string | STRING(20) | Sí | — | — |
| `schemaReference` | `schema_reference` | string \| null | STRING(180) | No | — | — |
| `dtoReference` | `dto_reference` | string \| null | STRING(180) | No | — | — |
| `schemaJson` | `schema_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `requiredFieldsJson` | `required_fields_json` | string[] | JSONB | Sí | — | — |
| `optionalFieldsJson` | `optional_fields_json` | string[] | JSONB | Sí | — | — |
| `samplePayloadJson` | `sample_payload_json` | Record<string, unknown> | JSONB | Sí | — | — |
| `businessReason` | `business_reason` | string \| null | TEXT | No | — | — |
| `validationLayer` | `validation_layer` | string | STRING(80) | Sí | — | — |
| `sourceFile` | `source_file` | string \| null | TEXT | No | — | — |
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
| `endpoint_id, contract_type, COALESCE(schema_reference, ''` | Único | — | btree |
| `endpoint_id` | No único | — | btree |
| `endpoint_id, contract_type, COALESCE(schema_reference, ''` | Único | — | btree |
| `endpoint_id` | No único | — | btree |
| `review_status` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-endpoint-payload-contracts.model.ts`](../../../../src/database/models/system-endpoint-payload-contracts.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
