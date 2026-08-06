---
title: "operational_audit_logs"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Auditoría y calidad"
schema: "audit"
table: "operational_audit_logs"
orm_model: "OperationalAuditLogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/audit"
source_files:
  - "src/database/models/operational-audit-logs.model.ts"
aliases:
  - "OperationalAuditLogModel"
---
# `audit.operational_audit_logs`

> [!info] Verificado
> Modelo ORM `OperationalAuditLogModel` en [`src/database/models/operational-audit-logs.model.ts`](../../../../src/database/models/operational-audit-logs.model.ts). Esquema físico `audit` resuelto por `atlasSchemaFor('operational_audit_logs')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `audit.operational_audit_logs`
- **Modelo ORM:** `OperationalAuditLogModel`
- **Dominio:** Auditoría y calidad → [[audit-schema]]
- **Atributos:** 13 · **FK salientes:** 3 · **Referencias entrantes:** 0

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
| `tenantId` | `_tenant_id` | string \| null | BIGINT | No | FK | — |
| `actorType` | `actor_type` | string \| null | STRING(40) | No | — | — |
| `actorInternalUserId` | `actor_internal_user_id` | string \| null | BIGINT | No | FK | — |
| `actorPlatformUserId` | `actor_platform_user_id` | string \| null | BIGINT | No | FK | — |
| `actionCode` | `action_code` | string \| null | STRING(120) | No | — | — |
| `targetType` | `target_type` | string \| null | STRING(120) | No | — | — |
| `targetId` | `target_id` | string \| null | STRING(120) | No | — | — |
| `ipAddress` | `ip_address` | string \| null | INET | No | — | PII |
| `userAgent` | `user_agent` | string \| null | TEXT | No | — | — |
| `payloadJson` | `payload_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `occurredAt` | `occurred_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 13 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `ip_address`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Opcional (0..1) | `SET NULL` |
| `actor_internal_user_id` | [[internal_users]] | `_id` | Opcional (0..1) | `SET NULL` |
| `actor_platform_user_id` | [[platform_users]] | `_id` | Opcional (0..1) | `SET NULL` |

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
> 2 columna(s) FK no encabezan ningún índice: `actor_internal_user_id`, `actor_platform_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/operational-audit-logs.model.ts`](../../../../src/database/models/operational-audit-logs.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154103-schema-relationships-part-9-audit-quality.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
