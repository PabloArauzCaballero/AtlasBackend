---
title: "system_action_logs"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_action_logs"
orm_model: "SystemActionLogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-action-logs.model.ts"
aliases:
  - "SystemActionLogModel"
---
# `platform_ops.system_action_logs`

> [!info] Verificado
> Modelo ORM `SystemActionLogModel` en [`src/database/models/system-action-logs.model.ts`](../../../../src/database/models/system-action-logs.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_action_logs')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_action_logs`
- **Modelo ORM:** `SystemActionLogModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 34 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `tenantId` | `_tenant_id` | string \| null | BIGINT | No | — | — |
| `requestId` | `request_id` | string \| null | STRING(120) | No | — | — |
| `correlationId` | `correlation_id` | string \| null | STRING(120) | No | — | — |
| `endpointCatalogId` | `endpoint_catalog_id` | string \| null | BIGINT | No | — | — |
| `actorUserId` | `actor_user_id` | string \| null | STRING(80) | No | — | — |
| `actorType` | `actor_type` | string \| null | STRING(60) | No | — | — |
| `actorRole` | `actor_role` | string \| null | STRING(80) | No | — | — |
| `actorInternalUserId` | `actor_internal_user_id` | string \| null | BIGINT | No | — | — |
| `actorPlatformUserId` | `actor_platform_user_id` | string \| null | BIGINT | No | — | — |
| `method` | `method` | string | STRING(12) | Sí | — | — |
| `routeTemplate` | `route_template` | string \| null | TEXT | No | — | — |
| `resolvedUrlSanitized` | `resolved_url_sanitized` | string | TEXT | Sí | — | — |
| `module` | `module` | string \| null | STRING(120) | No | — | — |
| `actionName` | `action_name` | string \| null | STRING(180) | No | — | — |
| `ipAddress` | `ip_address` | string \| null | INET | No | — | PII |
| `userAgent` | `user_agent` | string \| null | TEXT | No | — | — |
| `targetType` | `target_type` | string \| null | STRING(120) | No | — | — |
| `targetId` | `target_id` | string \| null | STRING(120) | No | — | — |
| `merchantId` | `merchant_id` | string \| null | BIGINT | No | — | — |
| `customerId` | `customer_id` | string \| null | BIGINT | No | — | — |
| `requestPayloadSanitized` | `request_payload_sanitized` | Record<string, unknown> | JSONB | Sí | — | — |
| `requestPayloadHash` | `request_payload_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `responseStatusCode` | `response_status_code` | number \| null | INTEGER | No | — | — |
| `responseSummarySanitized` | `response_summary_sanitized` | Record<string, unknown> | JSONB | Sí | — | — |
| `errorCode` | `error_code` | string \| null | STRING(120) | No | — | — |
| `errorMessage` | `error_message` | string \| null | TEXT | No | — | — |
| `durationMs` | `duration_ms` | number \| null | INTEGER | No | — | — |
| `idempotencyKeyHash` | `idempotency_key_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `idempotencyKeyLast4` | `idempotency_key_last4` | string \| null | STRING(8) | No | — | PII parcial |
| `riskLevel` | `risk_level` | string | STRING(20) | Sí | — | — |
| `containsPii` | `contains_pii` | boolean | BOOLEAN | Sí | — | — |
| `occurredAt` | `occurred_at` | Date | DATE | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 4 de 34 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `ip_address`, `request_payload_hash`, `idempotency_key_hash`, `idempotency_key_last4`. Ver [[05-data/sensitive-data]].

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
| `request_id` | No único | — | btree |
| `correlation_id` | No único | — | btree |
| `endpoint_catalog_id` | No único | — | btree |
| `method, resolved_url_sanitized` | No único | — | btree |
| `actor_type, actor_user_id` | No único | — | btree |
| `response_status_code` | No único | — | btree |
| `occurred_at DESC` | No único | — | btree |
| `module` | No único | — | btree |
| `risk_level` | No único | — | btree |
| `contains_pii` | No único | — | btree |
| `_tenant_id, occurred_at DESC` | No único | — | btree |
| `occurred_at` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-action-logs.model.ts`](../../../../src/database/models/system-action-logs.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
