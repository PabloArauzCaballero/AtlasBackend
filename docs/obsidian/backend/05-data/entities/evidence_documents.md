---
title: "evidence_documents"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Privacidad y consentimiento"
schema: "privacy"
table: "evidence_documents"
orm_model: "EvidenceDocumentModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/privacy"
source_files:
  - "src/database/models/evidence-documents.model.ts"
aliases:
  - "EvidenceDocumentModel"
---
# `privacy.evidence_documents`

> [!info] Verificado
> Modelo ORM `EvidenceDocumentModel` en [`src/database/models/evidence-documents.model.ts`](../../../../../src/database/models/evidence-documents.model.ts). Esquema físico `privacy` resuelto por `atlasSchemaFor('evidence_documents')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `privacy.evidence_documents`
- **Modelo ORM:** `EvidenceDocumentModel`
- **Dominio:** Privacidad y consentimiento → [[privacy-schema]]
- **Atributos:** 20 · **FK salientes:** 4 · **Referencias entrantes:** 8

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
| `documentType` | `document_type` | string \| null | STRING(80) | No | — | — |
| `s3Bucket` | `s3_bucket` | string \| null | STRING(120) | No | — | — |
| `s3Key` | `s3_key` | string \| null | TEXT | No | — | — |
| `fileHashSha256` | `file_hash_sha256` | string \| null | STRING(128) | No | — | — |
| `mimeType` | `mime_type` | string \| null | STRING(100) | No | — | — |
| `fileSizeBytes` | `file_size_bytes` | string \| null | BIGINT | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `uploadedAt` | `uploaded_at` | Date \| null | DATE | No | — | — |
| `uploadedFromIp` | `uploaded_from_ip` | string \| null | INET | No | — | — |
| `uploadedFromSessionId` | `uploaded_from_session_id` | string \| null | BIGINT | No | FK | — |
| `uploadedFromDeviceFingerprint` | `uploaded_from_device_fingerprint` | string \| null | STRING(180) | No | — | — |
| `retentionPolicyId` | `retention_policy_id` | string \| null | BIGINT | No | FK | — |
| `expiresAt` | `expires_at` | string \| null | DATEONLY | No | — | — |
| `retentionUntil` | `retention_until` | string \| null | DATEONLY | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `uploaded_from_session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |
| `retention_policy_id` | [[retention_policies]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[customer_identity_documents]] | `front_evidence_id` | 0..N opcional |
| [[customer_identity_documents]] | `back_evidence_id` | 0..N opcional |
| [[identity_verification_attempts]] | `selfie_evidence_id` | 0..N opcional |
| [[customer_address_versions]] | `evidence_id` | 0..N opcional |
| [[evidence_extractions]] | `evidence_document_id` | 0..N opcional |
| [[evidence_reviews]] | `evidence_document_id` | 0..N opcional |
| [[customer_observations]] | `evidence_id` | 0..N opcional |
| [[customer_attribute_values]] | `evidence_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | `_deleted = false` | btree |

> [!warning] FK sin índice dedicado
> 3 columna(s) FK no encabezan ningún índice: `customer_id`, `uploaded_from_session_id`, `retention_policy_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

- `ck_evidence_document_not_orphan`: `customer_id IS NOT NULL OR uploaded_from_session_id IS NOT NULL` — origen: `20260626154056-schema-relationships-part-2-privacy-consents.ts`

## Evidencia y referencias

- Modelo: [`src/database/models/evidence-documents.model.ts`](../../../../../src/database/models/evidence-documents.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154056-schema-relationships-part-2-privacy-consents.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
