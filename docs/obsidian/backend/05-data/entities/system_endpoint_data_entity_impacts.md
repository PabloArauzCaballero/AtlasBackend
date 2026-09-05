---
title: "system_endpoint_data_entity_impacts"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_endpoint_data_entity_impacts"
orm_model: "SystemEndpointDataEntityImpactModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-endpoint-data-entity-impacts.model.ts"
aliases:
  - "SystemEndpointDataEntityImpactModel"
---
# `platform_ops.system_endpoint_data_entity_impacts`

> [!info] Verificado
> Modelo ORM `SystemEndpointDataEntityImpactModel` en [`src/database/models/system-endpoint-data-entity-impacts.model.ts`](../../../../../src/database/models/system-endpoint-data-entity-impacts.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_endpoint_data_entity_impacts')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_endpoint_data_entity_impacts`
- **Modelo ORM:** `SystemEndpointDataEntityImpactModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 23 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `operationType` | `operation_type` | string | STRING(40) | Sí | — | — |
| `impactLevel` | `impact_level` | string | STRING(20) | Sí | — | — |
| `isPrimaryEntity` | `is_primary_entity` | boolean | BOOLEAN | Sí | — | — |
| `isTransactional` | `is_transactional` | boolean | BOOLEAN | Sí | — | — |
| `rollbackRequired` | `rollback_required` | boolean | BOOLEAN | Sí | — | — |
| `affectsCustomerState` | `affects_customer_state` | boolean | BOOLEAN | Sí | — | — |
| `affectsFinancialState` | `affects_financial_state` | boolean | BOOLEAN | Sí | — | — |
| `affectsRiskState` | `affects_risk_state` | boolean | BOOLEAN | Sí | — | — |
| `affectsLegalState` | `affects_legal_state` | boolean | BOOLEAN | Sí | — | — |
| `affectsDeviceState` | `affects_device_state` | boolean | BOOLEAN | Sí | — | — |
| `affectsNotificationState` | `affects_notification_state` | boolean | BOOLEAN | Sí | — | — |
| `requiresAuditLog` | `requires_audit_log` | boolean | BOOLEAN | Sí | — | — |
| `requiresRegressionTest` | `requires_regression_test` | boolean | BOOLEAN | Sí | — | — |
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
| `endpoint_id, data_entity_id, operation_type` | Único | — | btree |
| `endpoint_id` | No único | — | btree |
| `data_entity_id` | No único | — | btree |
| `review_status` | No único | — | btree |
| `endpoint_id` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-endpoint-data-entity-impacts.model.ts`](../../../../../src/database/models/system-endpoint-data-entity-impacts.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
