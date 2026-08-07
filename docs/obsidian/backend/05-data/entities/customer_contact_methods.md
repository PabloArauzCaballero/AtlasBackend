---
title: "customer_contact_methods"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Clientes e identidad"
schema: "customer"
table: "customer_contact_methods"
orm_model: "CustomerContactMethodModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/customer"
source_files:
  - "src/database/models/customer-contact-methods.model.ts"
aliases:
  - "CustomerContactMethodModel"
---
# `customer.customer_contact_methods`

> [!info] Verificado
> Modelo ORM `CustomerContactMethodModel` en [`src/database/models/customer-contact-methods.model.ts`](../../../../../src/database/models/customer-contact-methods.model.ts). Esquema físico `customer` resuelto por `atlasSchemaFor('customer_contact_methods')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `customer.customer_contact_methods`
- **Modelo ORM:** `CustomerContactMethodModel`
- **Dominio:** Clientes e identidad → [[customer-schema]]
- **Atributos:** 18 · **FK salientes:** 2 · **Referencias entrantes:** 1

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
| `customerId` | `customer_id` | string \| null | BIGINT | No | FK | — |
| `contactType` | `contact_type` | string \| null | STRING(30) | No | — | — |
| `contactValueHash` | `contact_value_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `contactValueEncrypted` | `contact_value_encrypted` | string \| null | BLOB | No | — | PII cifrada |
| `normalizedValueHash` | `normalized_value_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `valueLast4` | `value_last_4` | string \| null | STRING(4) | No | — | PII parcial |
| `emailDomain` | `email_domain` | string \| null | STRING(120) | No | — | PII |
| `label` | `label` | string \| null | STRING(40) | No | — | — |
| `isPrimary` | `is_primary` | boolean \| null | BOOLEAN | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `sourceType` | `source_type` | string \| null | STRING(60) | No | — | — |
| `firstSeenAt` | `first_seen_at` | Date \| null | DATE | No | — | — |
| `lastSeenAt` | `last_seen_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |

> [!warning] Datos sensibles
> 5 de 18 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `contact_value_hash`, `contact_value_encrypted`, `normalized_value_hash`, `value_last_4`, `email_domain`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[contact_verification_attempts]] | `contact_method_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | `_deleted = false` | btree |
| `contact_value_hash` | No único | — | btree |
| `normalized_value_hash` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `customer_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-contact-methods.model.ts`](../../../../../src/database/models/customer-contact-methods.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154055-schema-relationships-part-1-customers-identity.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
