---
title: "customer_reference_contacts"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Clientes e identidad"
schema: "customer"
table: "customer_reference_contacts"
orm_model: "CustomerReferenceContactModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/customer"
source_files:
  - "src/database/models/customer-reference-contacts.model.ts"
aliases:
  - "CustomerReferenceContactModel"
---
# `customer.customer_reference_contacts`

> [!info] Verificado
> Modelo ORM `CustomerReferenceContactModel` en [`src/database/models/customer-reference-contacts.model.ts`](../../../../src/database/models/customer-reference-contacts.model.ts). Esquema físico `customer` resuelto por `atlasSchemaFor('customer_reference_contacts')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `customer.customer_reference_contacts`
- **Modelo ORM:** `CustomerReferenceContactModel`
- **Dominio:** Clientes e identidad → [[customer-schema]]
- **Atributos:** 17 · **FK salientes:** 2 · **Referencias entrantes:** 0

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
| `relationshipType` | `relationship_type` | string \| null | STRING(60) | No | — | — |
| `fullNameHash` | `full_name_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `fullNameEncrypted` | `full_name_encrypted` | string \| null | BLOB | No | — | PII cifrada |
| `phoneHash` | `phone_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `phoneEncrypted` | `phone_encrypted` | string \| null | BLOB | No | — | PII cifrada |
| `phoneLast4` | `phone_last_4` | string \| null | STRING(4) | No | — | PII parcial |
| `consentBasis` | `consent_basis` | string \| null | STRING(80) | No | — | — |
| `referenceNotified` | `reference_notified` | boolean \| null | BOOLEAN | No | — | — |
| `referenceNotifiedAt` | `reference_notified_at` | Date \| null | DATE | No | — | — |
| `contactabilityStatus` | `contactability_status` | string \| null | STRING(40) | No | — | — |
| `verificationStatus` | `verification_status` | string \| null | STRING(40) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |

> [!warning] Datos sensibles
> 5 de 17 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `full_name_hash`, `full_name_encrypted`, `phone_hash`, `phone_encrypted`, `phone_last_4`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | `_deleted = false` | btree |
| `phone_hash` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `customer_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-reference-contacts.model.ts`](../../../../src/database/models/customer-reference-contacts.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154055-schema-relationships-part-1-customers-identity.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
