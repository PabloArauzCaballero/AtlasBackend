---
title: "data_providers"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Integraciones externas"
schema: "integrations"
table: "data_providers"
orm_model: "DataProviderModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/integrations"
source_files:
  - "src/database/models/data-providers.model.ts"
aliases:
  - "DataProviderModel"
---
# `integrations.data_providers`

> [!info] Verificado
> Modelo ORM `DataProviderModel` en [`src/database/models/data-providers.model.ts`](../../../../../src/database/models/data-providers.model.ts). Esquema físico `integrations` resuelto por `atlasSchemaFor('data_providers')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `integrations.data_providers`
- **Modelo ORM:** `DataProviderModel`
- **Dominio:** Integraciones externas → [[integrations-schema]]
- **Atributos:** 17 · **FK salientes:** 1 · **Referencias entrantes:** 2

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
| `providerCode` | `provider_code` | string \| null | STRING(80) | No | — | — |
| `providerName` | `provider_name` | string \| null | STRING(180) | No | — | — |
| `providerType` | `provider_type` | string \| null | STRING(60) | No | — | — |
| `reliabilityScore` | `reliability_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `providerCategory` | `provider_category` | string \| null | STRING(60) | No | — | — |
| `providerStatus` | `provider_status` | string \| null | STRING(30) | No | — | — |
| `defaultMode` | `default_mode` | string \| null | STRING(30) | No | — | — |
| `requiresConsent` | `requires_consent` | boolean \| null | BOOLEAN | No | — | — |
| `requiresManualApproval` | `requires_manual_approval` | boolean \| null | BOOLEAN | No | — | — |
| `isCostly` | `is_costly` | boolean \| null | BOOLEAN | No | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `supportsRetroData` | `supports_retro_data` | boolean \| null | BOOLEAN | No | — | — |
| `defaultRetentionPolicyId` | `default_retention_policy_id` | string \| null | BIGINT | No | FK | — |
| `isActive` | `is_active` | boolean \| null | BOOLEAN | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `default_retention_policy_id` | [[retention_policies]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[data_provider_requests]] | `provider_id` | 0..N opcional |
| [[customer_observations]] | `source_provider_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `provider_code` | Único | — | btree |
| `"provider_code"` | Único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `default_retention_policy_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/data-providers.model.ts`](../../../../../src/database/models/data-providers.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154054-schema-relationships-part-0-platform-core.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
