---
title: "data_provider_requests"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Integraciones externas"
schema: "integrations"
table: "data_provider_requests"
orm_model: "DataProviderRequestModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/integrations"
source_files:
  - "src/database/models/data-provider-requests.model.ts"
aliases:
  - "DataProviderRequestModel"
---
# `integrations.data_provider_requests`

> [!info] Verificado
> Modelo ORM `DataProviderRequestModel` en [`src/database/models/data-provider-requests.model.ts`](../../../../src/database/models/data-provider-requests.model.ts). Esquema físico `integrations` resuelto por `atlasSchemaFor('data_provider_requests')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `integrations.data_provider_requests`
- **Modelo ORM:** `DataProviderRequestModel`
- **Dominio:** Integraciones externas → [[integrations-schema]]
- **Atributos:** 29 · **FK salientes:** 5 · **Referencias entrantes:** 4

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
| `providerId` | `provider_id` | string \| null | BIGINT | No | FK | — |
| `customerId` | `customer_id` | string \| null | BIGINT | No | FK | — |
| `riskAssessmentRunId` | `risk_assessment_run_id` | string \| null | BIGINT | No | FK | — |
| `consentId` | `consent_id` | string \| null | BIGINT | No | FK | — |
| `requestType` | `request_type` | string \| null | STRING(80) | No | — | — |
| `providerRequestRef` | `provider_request_ref` | string \| null | STRING(160) | No | — | — |
| `purposeCode` | `purpose_code` | string \| null | STRING(100) | No | — | — |
| `decisionStage` | `decision_stage` | string \| null | STRING(60) | No | — | — |
| `modeUsed` | `mode_used` | string \| null | STRING(30) | No | — | — |
| `estimatedCostAmount` | `estimated_cost_amount` | string \| null | DECIMAL(18, 4) | No | — | — |
| `actualCostAmount` | `actual_cost_amount` | string \| null | DECIMAL(18, 4) | No | — | — |
| `currency` | `currency` | string \| null | STRING(3) | No | — | — |
| `requestedByUserId` | `requested_by_user_id` | string \| null | BIGINT | No | — | — |
| `approvedByAdminId` | `approved_by_admin_id` | string \| null | BIGINT | No | — | — |
| `approvalStatus` | `approval_status` | string \| null | STRING(40) | No | — | — |
| `errorMessageSafe` | `error_message_safe` | string \| null | TEXT | No | — | — |
| `metadataJson` | `metadata_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `cachedFromRequestId` | `cached_from_request_id` | string \| null | BIGINT | No | — | — |
| `retryOfRequestId` | `retry_of_request_id` | string \| null | BIGINT | No | — | — |
| `requestPayloadHash` | `request_payload_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `idempotencyKey` | `idempotency_key` | string \| null | STRING(128) | No | — | — |
| `responseStatus` | `response_status` | string \| null | STRING(40) | No | — | — |
| `responseCode` | `response_code` | string \| null | STRING(80) | No | — | — |
| `latencyMs` | `latency_ms` | number \| null | INTEGER | No | — | — |
| `requestedAt` | `requested_at` | Date \| null | DATE | No | — | — |
| `respondedAt` | `responded_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 29 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `request_payload_hash`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `provider_id` | [[data_providers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `risk_assessment_run_id` | [[risk_assessment_runs]] | `_id` | Opcional (0..1) | `SET NULL` |
| `consent_id` | [[customer_consents]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[data_provider_responses]] | `provider_request_id` | 0..N opcional |
| [[identity_verification_attempts]] | `provider_request_id` | 0..N opcional |
| [[contact_verification_attempts]] | `provider_request_id` | 0..N opcional |
| [[ip_reputation_observations]] | `provider_request_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `"_tenant_id", "provider_id", "customer_id", "request_type", "request_payload_hash", "response_status", "requested_at"` | No único | — | btree |
| `"provider_id", "requested_at", "response_status"` | No único | — | btree |
| `"_tenant_id", "idempotency_key", "requested_at"` | No único | — | btree |
| `"_tenant_id", "idempotency_key"` | Único | — | btree |

> [!warning] FK sin índice dedicado
> 4 columna(s) FK no encabezan ningún índice: `provider_id`, `customer_id`, `risk_assessment_run_id`, `consent_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/data-provider-requests.model.ts`](../../../../src/database/models/data-provider-requests.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154054-schema-relationships-part-0-platform-core.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
