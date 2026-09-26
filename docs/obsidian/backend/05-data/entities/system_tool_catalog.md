---
title: "system_tool_catalog"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_tool_catalog"
orm_model: "SystemToolCatalogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-tool-catalog.model.ts"
aliases:
  - "SystemToolCatalogModel"
---
# `platform_ops.system_tool_catalog`

> [!info] Verificado
> Modelo ORM `SystemToolCatalogModel` en [`src/database/models/system-tool-catalog.model.ts`](../../../../../src/database/models/system-tool-catalog.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_tool_catalog')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_tool_catalog`
- **Modelo ORM:** `SystemToolCatalogModel`
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
| `code` | `code` | string | STRING(160) | Sí | — | — |
| `name` | `name` | string | STRING(220) | Sí | — | — |
| `type` | `type` | string | STRING(80) | Sí | — | — |
| `provider` | `provider` | string \| null | STRING(160) | No | — | — |
| `purpose` | `purpose` | string | TEXT | Sí | — | — |
| `requiredEnvVars` | `required_env_vars` | string[] | JSONB | Sí | — | — |
| `hasSandbox` | `has_sandbox` | boolean | BOOLEAN | Sí | — | — |
| `healthcheckRoute` | `healthcheck_route` | string \| null | TEXT | No | — | — |
| `requiresCredentials` | `requires_credentials` | boolean | BOOLEAN | Sí | — | Credencial |
| `isCritical` | `is_critical` | boolean | BOOLEAN | Sí | — | — |
| `isWorker` | `is_worker` | boolean | BOOLEAN | Sí | — | — |
| `status` | `status` | string | STRING(40) | Sí | — | — |
| `ownerTeam` | `owner_team` | string | STRING(120) | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 16 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `requires_credentials`. Ver [[05-data/sensitive-data]].

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
| `type` | No único | — | btree |
| `status` | No único | — | btree |
| `is_critical` | No único | — | btree |
| `is_worker` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-tool-catalog.model.ts`](../../../../../src/database/models/system-tool-catalog.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
