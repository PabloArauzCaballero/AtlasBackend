---
title: "fraud_case_events"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Gestión de casos y fraude"
schema: "case_management"
table: "fraud_case_events"
orm_model: "FraudCaseEventModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/case_management"
source_files:
  - "src/database/models/fraud-case-events.model.ts"
aliases:
  - "FraudCaseEventModel"
---
# `case_management.fraud_case_events`

> [!info] Verificado
> Modelo ORM `FraudCaseEventModel` en [`src/database/models/fraud-case-events.model.ts`](../../../../../src/database/models/fraud-case-events.model.ts). Esquema físico `case_management` resuelto por `atlasSchemaFor('fraud_case_events')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `case_management.fraud_case_events`
- **Modelo ORM:** `FraudCaseEventModel`
- **Dominio:** Gestión de casos y fraude → [[case_management-schema]]
- **Atributos:** 10 · **FK salientes:** 3 · **Referencias entrantes:** 0

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
| `fraudCaseId` | `fraud_case_id` | string \| null | BIGINT | No | FK | — |
| `eventType` | `event_type` | string \| null | STRING(60) | No | — | — |
| `actorType` | `actor_type` | string \| null | STRING(40) | No | — | — |
| `actorInternalUserId` | `actor_internal_user_id` | string \| null | BIGINT | No | FK | — |
| `happenedAt` | `happened_at` | Date \| null | DATE | No | — | — |
| `payloadJson` | `payload_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `notes` | `notes` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `fraud_case_id` | [[fraud_cases]] | `_id` | Opcional (0..1) | `SET NULL` |
| `actor_internal_user_id` | [[internal_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `_tenant_id, happened_at DESC, _id DESC` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `fraud_case_id`, `actor_internal_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/fraud-case-events.model.ts`](../../../../../src/database/models/fraud-case-events.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154102-schema-relationships-part-8-fraud-review.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
