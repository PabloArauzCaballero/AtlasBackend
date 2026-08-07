---
title: "customer_identity_documents"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Clientes e identidad"
schema: "customer"
table: "customer_identity_documents"
orm_model: "CustomerIdentityDocumentModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/customer"
source_files:
  - "src/database/models/customer-identity-documents.model.ts"
aliases:
  - "CustomerIdentityDocumentModel"
---
# `customer.customer_identity_documents`

> [!info] Verificado
> Modelo ORM `CustomerIdentityDocumentModel` en [`src/database/models/customer-identity-documents.model.ts`](../../../../../src/database/models/customer-identity-documents.model.ts). Esquema físico `customer` resuelto por `atlasSchemaFor('customer_identity_documents')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `customer.customer_identity_documents`
- **Modelo ORM:** `CustomerIdentityDocumentModel`
- **Dominio:** Clientes e identidad → [[customer-schema]]
- **Atributos:** 23 · **FK salientes:** 4 · **Referencias entrantes:** 1

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
| `documentType` | `document_type` | string \| null | STRING(30) | No | — | — |
| `declaredNumberHash` | `declared_number_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `declaredNumberEncrypted` | `declared_number_encrypted` | string \| null | BLOB | No | — | PII cifrada |
| `declaredNumberLast4` | `declared_number_last_4` | string \| null | STRING(4) | No | — | PII parcial |
| `declaredComplement` | `declared_complement` | string \| null | STRING(10) | No | — | — |
| `declaredIssuedIn` | `declared_issued_in` | string \| null | STRING(60) | No | — | — |
| `ocrNumberHash` | `ocr_number_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `ocrFullName` | `ocr_full_name` | string \| null | STRING(260) | No | — | PII |
| `ocrBirthDate` | `ocr_birth_date` | string \| null | DATEONLY | No | — | PII |
| `ocrConfidenceScore` | `ocr_confidence_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `verifiedNumberHash` | `verified_number_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `issuedAt` | `issued_at` | string \| null | DATEONLY | No | — | — |
| `expiresAt` | `expires_at` | string \| null | DATEONLY | No | — | — |
| `frontEvidenceId` | `front_evidence_id` | string \| null | BIGINT | No | FK | — |
| `backEvidenceId` | `back_evidence_id` | string \| null | BIGINT | No | FK | — |
| `verificationStatus` | `verification_status` | string \| null | STRING(40) | No | — | — |
| `verifiedAt` | `verified_at` | Date \| null | DATE | No | — | — |
| `validFrom` | `valid_from` | Date \| null | DATE | No | — | — |
| `validUntil` | `valid_until` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 7 de 23 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `declared_number_hash`, `declared_number_encrypted`, `declared_number_last_4`, `ocr_number_hash`, `ocr_full_name`, `ocr_birth_date`, `verified_number_hash`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `front_evidence_id` | [[evidence_documents]] | `_id` | Opcional (0..1) | `SET NULL` |
| `back_evidence_id` | [[evidence_documents]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[identity_verification_attempts]] | `identity_document_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `customer_id, valid_until` | No único | `valid_until IS NULL` | btree |
| `declared_number_hash` | No único | — | btree |
| `verified_number_hash` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `front_evidence_id`, `back_evidence_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-identity-documents.model.ts`](../../../../../src/database/models/customer-identity-documents.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154055-schema-relationships-part-1-customers-identity.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
