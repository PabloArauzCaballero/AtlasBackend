---
title: "system_endpoint_catalog"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_endpoint_catalog"
orm_model: "SystemEndpointCatalogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-endpoint-catalog.model.ts"
aliases:
  - "SystemEndpointCatalogModel"
---
# `platform_ops.system_endpoint_catalog`

> [!info] Verificado
> Modelo ORM `SystemEndpointCatalogModel` en [`src/database/models/system-endpoint-catalog.model.ts`](../../../../../src/database/models/system-endpoint-catalog.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_endpoint_catalog')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_endpoint_catalog`
- **Modelo ORM:** `SystemEndpointCatalogModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 42 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `code` | `code` | string | STRING(180) | Sí | — | — |
| `module` | `module` | string | STRING(120) | Sí | — | — |
| `backendService` | `backend_service` | string | STRING(120) | Sí | — | — |
| `backendBaseUrl` | `backend_base_url` | string \| null | TEXT | No | — | — |
| `controllerName` | `controller_name` | string \| null | STRING(180) | No | — | — |
| `handlerName` | `handler_name` | string \| null | STRING(180) | No | — | — |
| `method` | `method` | string | STRING(12) | Sí | — | — |
| `routePath` | `route_path` | string | TEXT | Sí | — | — |
| `fullPath` | `full_path` | string | TEXT | Sí | — | — |
| `routeName` | `route_name` | string | STRING(220) | Sí | — | — |
| `businessPurpose` | `business_purpose` | string | TEXT | Sí | — | — |
| `businessAction` | `business_action` | string \| null | TEXT | No | — | — |
| `expectedResponseSummary` | `expected_response_summary` | string \| null | TEXT | No | — | — |
| `expectedStatusCodes` | `expected_status_codes` | unknown[] | JSONB | Sí | — | — |
| `minPayloadSchema` | `min_payload_schema` | Record<string, unknown> | JSONB | Sí | — | — |
| `queryParamsSchema` | `query_params_schema` | Record<string, unknown> | JSONB | Sí | — | — |
| `pathParamsSchema` | `path_params_schema` | Record<string, unknown> | JSONB | Sí | — | — |
| `headersSchema` | `headers_schema` | Record<string, unknown> | JSONB | Sí | — | — |
| `requiresAuth` | `requires_auth` | boolean | BOOLEAN | Sí | — | — |
| `allowedRoles` | `allowed_roles` | string[] | JSONB | Sí | — | — |
| `containsPii` | `contains_pii` | boolean | BOOLEAN | Sí | — | — |
| `piiFields` | `pii_fields` | string[] | JSONB | Sí | — | — |
| `riskLevel` | `risk_level` | string | STRING(20) | Sí | — | — |
| `isDestructive` | `is_destructive` | boolean | BOOLEAN | Sí | — | — |
| `isReadonly` | `is_readonly` | boolean | BOOLEAN | Sí | — | — |
| `idempotencyRequired` | `idempotency_required` | boolean | BOOLEAN | Sí | — | — |
| `requiresStressTest` | `requires_stress_test` | boolean | BOOLEAN | Sí | — | — |
| `requiresIntegrationTest` | `requires_integration_test` | boolean | BOOLEAN | Sí | — | — |
| `isTestableFromPortal` | `is_testable_from_portal` | boolean | BOOLEAN | Sí | — | — |
| `testEnvironmentOnly` | `test_environment_only` | boolean | BOOLEAN | Sí | — | — |
| `ownerTeam` | `owner_team` | string | STRING(120) | Sí | — | — |
| `status` | `status` | string | STRING(40) | Sí | — | — |
| `version` | `version` | string | STRING(40) | Sí | — | — |
| `detectedFrom` | `detected_from` | string | STRING(80) | Sí | — | — |
| `confidenceLevel` | `confidence_level` | string | STRING(20) | Sí | — | — |
| `reviewStatus` | `review_status` | string | STRING(40) | Sí | — | — |
| `sourceFile` | `source_file` | string \| null | TEXT | No | — | — |
| `createdBy` | `created_by` | string \| null | STRING(80) | No | — | — |
| `updatedBy` | `updated_by` | string \| null | STRING(80) | No | — | — |
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
| `method, full_path` | Único | — | btree |
| `module` | No único | — | btree |
| `status` | No único | — | btree |
| `risk_level` | No único | — | btree |
| `requires_stress_test` | No único | — | btree |
| `review_status` | No único | — | btree |
| `backend_service` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-endpoint-catalog.model.ts`](../../../../../src/database/models/system-endpoint-catalog.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
