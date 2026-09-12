---
title: "external_oauth_connections"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Integraciones externas"
schema: "integrations"
table: "external_oauth_connections"
orm_model: "ExternalOauthConnectionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/integrations"
source_files:
  - "src/database/models/external-oauth-connections.model.ts"
aliases:
  - "ExternalOauthConnectionModel"
---
# `integrations.external_oauth_connections`

> [!info] Verificado
> Modelo ORM `ExternalOauthConnectionModel` en [`src/database/models/external-oauth-connections.model.ts`](../../../../../src/database/models/external-oauth-connections.model.ts). Esquema físico `integrations` resuelto por `atlasSchemaFor('external_oauth_connections')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `integrations.external_oauth_connections`
- **Modelo ORM:** `ExternalOauthConnectionModel`
- **Dominio:** Integraciones externas → [[integrations-schema]]
- **Atributos:** 16 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `tenantId` | `_tenant_id` | string | BIGINT | Sí | — | — |
| `customerId` | `customer_id` | string | BIGINT | Sí | — | — |
| `providerId` | `provider_id` | string | BIGINT | Sí | — | — |
| `providerCode` | `provider_code` | string | STRING(80) | Sí | — | — |
| `externalSubjectHash` | `external_subject_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `scopesGrantedJson` | `scopes_granted_json` | string[] \| null | JSONB | No | — | — |
| `tokenReference` | `token_reference` | string \| null | TEXT | No | — | Credencial |
| `tokenExpiresAt` | `token_expires_at` | Date \| null | DATE | No | — | Credencial |
| `connectionStatus` | `connection_status` | string | STRING(30) | Sí | — | — |
| `connectedAt` | `connected_at` | Date \| null | DATE | No | — | — |
| `disconnectedAt` | `disconnected_at` | Date \| null | DATE | No | — | — |
| `lastSyncAt` | `last_sync_at` | Date \| null | DATE | No | — | — |
| `metadataJson` | `metadata_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |

> [!warning] Datos sensibles
> 3 de 16 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `external_subject_hash`, `token_reference`, `token_expires_at`. Ver [[05-data/sensitive-data]].

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

- Modelo: [`src/database/models/external-oauth-connections.model.ts`](../../../../../src/database/models/external-oauth-connections.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
