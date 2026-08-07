---
title: "provider_health_logs"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Integraciones externas"
schema: "integrations"
table: "provider_health_logs"
orm_model: "ProviderHealthLogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/integrations"
source_files:
  - "src/database/models/provider-health-logs.model.ts"
aliases:
  - "ProviderHealthLogModel"
---
# `integrations.provider_health_logs`

> [!info] Verificado
> Modelo ORM `ProviderHealthLogModel` en [`src/database/models/provider-health-logs.model.ts`](../../../../../src/database/models/provider-health-logs.model.ts). Esquema físico `integrations` resuelto por `atlasSchemaFor('provider_health_logs')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `integrations.provider_health_logs`
- **Modelo ORM:** `ProviderHealthLogModel`
- **Dominio:** Integraciones externas → [[integrations-schema]]
- **Atributos:** 9 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `status` | `status` | string | STRING(20) | Sí | — | — |
| `modeChecked` | `mode_checked` | string | STRING(30) | Sí | — | — |
| `latencyMs` | `latency_ms` | number | INTEGER | Sí | — | — |
| `checkedAt` | `checked_at` | Date | DATE | Sí | — | — |
| `errorCode` | `error_code` | string \| null | STRING(80) | No | — | — |
| `errorMessageSafe` | `error_message_safe` | string \| null | TEXT | No | — | — |
| `metadataJson` | `metadata_json` | Record<string, unknown> \| null | JSONB | No | — | — |



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
| `provider_id, checked_at DESC, _id DESC` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/provider-health-logs.model.ts`](../../../../../src/database/models/provider-health-logs.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
