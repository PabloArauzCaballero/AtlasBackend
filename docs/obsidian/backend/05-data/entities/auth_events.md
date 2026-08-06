---
title: "auth_events"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Telemetría, dispositivos y sesiones"
schema: "telemetry"
table: "auth_events"
orm_model: "AuthEventModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/telemetry"
source_files:
  - "src/database/models/auth-events.model.ts"
aliases:
  - "AuthEventModel"
---
# `telemetry.auth_events`

> [!info] Verificado
> Modelo ORM `AuthEventModel` en [`src/database/models/auth-events.model.ts`](../../../../src/database/models/auth-events.model.ts). Esquema físico `telemetry` resuelto por `atlasSchemaFor('auth_events')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `telemetry.auth_events`
- **Modelo ORM:** `AuthEventModel`
- **Dominio:** Telemetría, dispositivos y sesiones → [[telemetry-schema]]
- **Atributos:** 11 · **FK salientes:** 4 · **Referencias entrantes:** 0

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
| `customerId` | `customer_id` | string \| null | BIGINT | No | FK | — |
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `deviceId` | `device_id` | string \| null | BIGINT | No | FK | — |
| `eventType` | `event_type` | string \| null | STRING(60) | No | — | — |
| `loginSuccessful` | `login_successful` | boolean \| null | BOOLEAN | No | — | — |
| `failureReasonCode` | `failure_reason_code` | string \| null | STRING(80) | No | — | — |
| `occurredAt` | `occurred_at` | Date \| null | DATE | No | — | — |
| `ipAddress` | `ip_address` | string \| null | INET | No | — | PII |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 11 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `ip_address`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `device_id` | [[devices]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `` | No único | — | btree |
| `_tenant_id, occurred_at DESC, _id DESC` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `customer_id`, `session_id`, `device_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/auth-events.model.ts`](../../../../src/database/models/auth-events.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154057-schema-relationships-part-3-devices-sessions.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
