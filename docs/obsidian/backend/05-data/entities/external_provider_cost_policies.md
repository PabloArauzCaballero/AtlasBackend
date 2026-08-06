---
title: "external_provider_cost_policies"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Integraciones externas"
schema: "integrations"
table: "external_provider_cost_policies"
orm_model: "ExternalProviderCostPolicyModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/integrations"
source_files:
  - "src/database/models/external-provider-cost-policies.model.ts"
aliases:
  - "ExternalProviderCostPolicyModel"
---
# `integrations.external_provider_cost_policies`

> [!info] Verificado
> Modelo ORM `ExternalProviderCostPolicyModel` en [`src/database/models/external-provider-cost-policies.model.ts`](../../../../src/database/models/external-provider-cost-policies.model.ts). Esquema físico `integrations` resuelto por `atlasSchemaFor('external_provider_cost_policies')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `integrations.external_provider_cost_policies`
- **Modelo ORM:** `ExternalProviderCostPolicyModel`
- **Dominio:** Integraciones externas → [[integrations-schema]]
- **Atributos:** 22 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `providerId` | `provider_id` | string | BIGINT | Sí | — | — |
| `queryType` | `query_type` | string | STRING(80) | Sí | — | — |
| `unitCostAmount` | `unit_cost_amount` | string | DECIMAL(18, 4) | Sí | — | — |
| `currency` | `currency` | string | STRING(3) | Sí | — | — |
| `costTier` | `cost_tier` | string | STRING(20) | Sí | — | — |
| `maxQueriesPerUserPerDay` | `max_queries_per_user_per_day` | number \| null | INTEGER | No | — | — |
| `maxQueriesPerUserPerMonth` | `max_queries_per_user_per_month` | number \| null | INTEGER | No | — | — |
| `maxQueriesGlobalPerDay` | `max_queries_global_per_day` | number \| null | INTEGER | No | — | — |
| `allowedDecisionStagesJson` | `allowed_decision_stages_json` | string[] \| null | JSONB | No | — | — |
| `requiresManualApproval` | `requires_manual_approval` | boolean | BOOLEAN | Sí | — | — |
| `requiresAdminRole` | `requires_admin_role` | boolean | BOOLEAN | Sí | — | — |
| `blockByDefault` | `block_by_default` | boolean | BOOLEAN | Sí | — | — |
| `cacheTtlSeconds` | `cache_ttl_seconds` | number \| null | INTEGER | No | — | — |
| `featureTtlSeconds` | `feature_ttl_seconds` | number \| null | INTEGER | No | — | — |
| `retryMaxAttempts` | `retry_max_attempts` | number \| null | INTEGER | No | — | — |
| `retryBackoffSeconds` | `retry_backoff_seconds` | number \| null | INTEGER | No | — | — |
| `active` | `active` | boolean | BOOLEAN | Sí | — | — |
| `activeFrom` | `active_from` | Date \| null | DATE | No | — | — |
| `activeTo` | `active_to` | Date \| null | DATE | No | — | — |
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
| — | — | — | — |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/external-provider-cost-policies.model.ts`](../../../../src/database/models/external-provider-cost-policies.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
