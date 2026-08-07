---
title: "data_subject_requests"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Privacidad y consentimiento"
schema: "privacy"
table: "data_subject_requests"
orm_model: "DataSubjectRequestModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/privacy"
source_files:
  - "src/database/models/data-subject-requests.model.ts"
aliases:
  - "DataSubjectRequestModel"
---
# `privacy.data_subject_requests`

> [!info] Verificado
> Modelo ORM `DataSubjectRequestModel` en [`src/database/models/data-subject-requests.model.ts`](../../../../../src/database/models/data-subject-requests.model.ts). Esquema físico `privacy` resuelto por `atlasSchemaFor('data_subject_requests')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `privacy.data_subject_requests`
- **Modelo ORM:** `DataSubjectRequestModel`
- **Dominio:** Privacidad y consentimiento → [[privacy-schema]]
- **Atributos:** 14 · **FK salientes:** 3 · **Referencias entrantes:** 0

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`VERIFICADO` — la tabla incluye `_tenant_id`, por lo que toda consulta debe filtrar por tenant. Ver [[08-security/authorization]].

## Borrado lógico

`VERIFICADO` — usa borrado lógico vía `_deleted`. Las lecturas deben excluir `_deleted = true`.

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `tenantId` | `_tenant_id` | string | BIGINT | Sí | FK | — |
| `requestCode` | `request_code` | string \| null | STRING(80) | No | — | — |
| `customerId` | `customer_id` | string \| null | BIGINT | No | FK | — |
| `requestType` | `request_type` | string \| null | STRING(60) | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `requestedAt` | `requested_at` | Date \| null | DATE | No | — | — |
| `dueAt` | `due_at` | Date \| null | DATE | No | — | — |
| `resolvedAt` | `resolved_at` | Date \| null | DATE | No | — | — |
| `handledBy` | `handled_by` | string \| null | BIGINT | No | FK | — |
| `resolutionNotes` | `resolution_notes` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `handled_by` | [[internal_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | `_deleted = false` | btree |
| `_tenant_id, request_code` | Único | `_deleted = false` | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `customer_id`, `handled_by`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/data-subject-requests.model.ts`](../../../../../src/database/models/data-subject-requests.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154056-schema-relationships-part-2-privacy-consents.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
