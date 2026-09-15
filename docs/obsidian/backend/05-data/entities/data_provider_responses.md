---
title: "data_provider_responses"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Integraciones externas"
schema: "integrations"
table: "data_provider_responses"
orm_model: "DataProviderResponseModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/integrations"
source_files:
  - "src/database/models/data-provider-responses.model.ts"
aliases:
  - "DataProviderResponseModel"
---
# `integrations.data_provider_responses`

> [!info] Verificado
> Modelo ORM `DataProviderResponseModel` en [`src/database/models/data-provider-responses.model.ts`](../../../../../src/database/models/data-provider-responses.model.ts). Esquema físico `integrations` resuelto por `atlasSchemaFor('data_provider_responses')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `integrations.data_provider_responses`
- **Modelo ORM:** `DataProviderResponseModel`
- **Dominio:** Integraciones externas → [[integrations-schema]]
- **Atributos:** 15 · **FK salientes:** 3 · **Referencias entrantes:** 0

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
| `providerRequestId` | `provider_request_id` | string \| null | BIGINT | No | FK | — |
| `payloadStorageStrategy` | `payload_storage_strategy` | string \| null | STRING(40) | No | — | — |
| `responsePayloadJson` | `response_payload_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `redactedPayloadJson` | `redacted_payload_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `rawPayloadS3Key` | `raw_payload_s3_key` | string \| null | TEXT | No | — | — |
| `responseHash` | `response_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `providerStatusCode` | `provider_status_code` | number \| null | INTEGER | No | — | — |
| `providerReference` | `provider_reference` | string \| null | STRING(160) | No | — | — |
| `normalizedPayloadJson` | `normalized_payload_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `containsSensitiveData` | `contains_sensitive_data` | boolean \| null | BOOLEAN | No | — | — |
| `retentionPolicyId` | `retention_policy_id` | string \| null | BIGINT | No | FK | — |
| `retentionUntil` | `retention_until` | string \| null | DATEONLY | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 15 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `response_hash`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `provider_request_id` | [[data_provider_requests]] | `_id` | Opcional (0..1) | `SET NULL` |
| `retention_policy_id` | [[retention_policies]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `"_tenant_id", "provider_request_id", "_created_at"` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `provider_request_id`, `retention_policy_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/data-provider-responses.model.ts`](../../../../../src/database/models/data-provider-responses.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154054-schema-relationships-part-0-platform-core.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
