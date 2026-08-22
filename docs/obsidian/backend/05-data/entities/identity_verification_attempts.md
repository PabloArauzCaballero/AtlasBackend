---
title: "identity_verification_attempts"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Clientes e identidad"
schema: "customer"
table: "identity_verification_attempts"
orm_model: "IdentityVerificationAttemptModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/customer"
source_files:
  - "src/database/models/identity-verification-attempts.model.ts"
aliases:
  - "IdentityVerificationAttemptModel"
---
# `customer.identity_verification_attempts`

> [!info] Verificado
> Modelo ORM `IdentityVerificationAttemptModel` en [`src/database/models/identity-verification-attempts.model.ts`](../../../../../src/database/models/identity-verification-attempts.model.ts). Esquema físico `customer` resuelto por `atlasSchemaFor('identity_verification_attempts')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `customer.identity_verification_attempts`
- **Modelo ORM:** `IdentityVerificationAttemptModel`
- **Dominio:** Clientes e identidad → [[customer-schema]]
- **Atributos:** 19 · **FK salientes:** 7 · **Referencias entrantes:** 0

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
| `identityDocumentId` | `identity_document_id` | string \| null | BIGINT | No | FK | — |
| `providerRequestId` | `provider_request_id` | string \| null | BIGINT | No | FK | — |
| `consentId` | `consent_id` | string \| null | BIGINT | No | FK | — |
| `verificationChannel` | `verification_channel` | string \| null | STRING(40) | No | — | — |
| `livenessScore` | `liveness_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `selfieMatchScore` | `selfie_match_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `documentForensicsScore` | `document_forensics_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `nameMatchScore` | `name_match_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `finalResult` | `final_result` | string \| null | STRING(40) | No | — | — |
| `reasonCodesJson` | `reason_codes_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `selfieEvidenceId` | `selfie_evidence_id` | string \| null | BIGINT | No | FK | — |
| `requestedAt` | `requested_at` | Date \| null | DATE | No | — | — |
| `completedAt` | `completed_at` | Date \| null | DATE | No | — | — |
| `manualReviewedBy` | `manual_reviewed_by` | string \| null | BIGINT | No | FK | — |
| `manualReviewNotes` | `manual_review_notes` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `identity_document_id` | [[customer_identity_documents]] | `_id` | Opcional (0..1) | `SET NULL` |
| `provider_request_id` | [[data_provider_requests]] | `_id` | Opcional (0..1) | `SET NULL` |
| `consent_id` | [[customer_consents]] | `_id` | Opcional (0..1) | `SET NULL` |
| `selfie_evidence_id` | [[evidence_documents]] | `_id` | Opcional (0..1) | `SET NULL` |
| `manual_reviewed_by` | [[internal_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 6 columna(s) FK no encabezan ningún índice: `customer_id`, `identity_document_id`, `provider_request_id`, `consent_id`, `selfie_evidence_id`, `manual_reviewed_by`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/identity-verification-attempts.model.ts`](../../../../../src/database/models/identity-verification-attempts.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154055-schema-relationships-part-1-customers-identity.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
