---
title: "contact_verification_attempts"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Clientes e identidad"
schema: "customer"
table: "contact_verification_attempts"
orm_model: "ContactVerificationAttemptModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/customer"
source_files:
  - "src/database/models/contact-verification-attempts.model.ts"
aliases:
  - "ContactVerificationAttemptModel"
---
# `customer.contact_verification_attempts`

> [!info] Verificado
> Modelo ORM `ContactVerificationAttemptModel` en [`src/database/models/contact-verification-attempts.model.ts`](../../../../../src/database/models/contact-verification-attempts.model.ts). Esquema físico `customer` resuelto por `atlasSchemaFor('contact_verification_attempts')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `customer.contact_verification_attempts`
- **Modelo ORM:** `ContactVerificationAttemptModel`
- **Dominio:** Clientes e identidad → [[customer-schema]]
- **Atributos:** 11 · **FK salientes:** 3 · **Referencias entrantes:** 0

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
| `contactMethodId` | `contact_method_id` | string \| null | BIGINT | No | FK | — |
| `providerRequestId` | `provider_request_id` | string \| null | BIGINT | No | FK | — |
| `verificationMethod` | `verification_method` | string \| null | STRING(60) | No | — | — |
| `verificationStatus` | `verification_status` | string \| null | STRING(40) | No | — | — |
| `confidenceScore` | `confidence_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `attemptedAt` | `attempted_at` | Date \| null | DATE | No | — | — |
| `verifiedAt` | `verified_at` | Date \| null | DATE | No | — | — |
| `failureReasonCode` | `failure_reason_code` | string \| null | STRING(80) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `contact_method_id` | [[customer_contact_methods]] | `_id` | Opcional (0..1) | `SET NULL` |
| `provider_request_id` | [[data_provider_requests]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `contact_method_id`, `provider_request_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/contact-verification-attempts.model.ts`](../../../../../src/database/models/contact-verification-attempts.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154055-schema-relationships-part-1-customers-identity.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
