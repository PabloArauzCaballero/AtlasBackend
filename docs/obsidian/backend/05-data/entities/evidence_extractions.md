---
title: "evidence_extractions"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Privacidad y consentimiento"
schema: "privacy"
table: "evidence_extractions"
orm_model: "EvidenceExtractionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/privacy"
source_files:
  - "src/database/models/evidence-extractions.model.ts"
aliases:
  - "EvidenceExtractionModel"
---
# `privacy.evidence_extractions`

> [!info] Verificado
> Modelo ORM `EvidenceExtractionModel` en [`src/database/models/evidence-extractions.model.ts`](../../../../src/database/models/evidence-extractions.model.ts). Esquema físico `privacy` resuelto por `atlasSchemaFor('evidence_extractions')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `privacy.evidence_extractions`
- **Modelo ORM:** `EvidenceExtractionModel`
- **Dominio:** Privacidad y consentimiento → [[privacy-schema]]
- **Atributos:** 12 · **FK salientes:** 2 · **Referencias entrantes:** 0

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
| `evidenceDocumentId` | `evidence_document_id` | string \| null | BIGINT | No | FK | — |
| `extractionMethod` | `extraction_method` | string \| null | STRING(80) | No | — | — |
| `extractionVersion` | `extraction_version` | string \| null | STRING(80) | No | — | — |
| `extractedDataJson` | `extracted_data_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `redactedExtractedDataJson` | `redacted_extracted_data_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `confidenceScore` | `confidence_score` | string \| null | DECIMAL(5, 2) | No | — | — |
| `extractedAt` | `extracted_at` | Date \| null | DATE | No | — | — |
| `processingDurationMs` | `processing_duration_ms` | number \| null | INTEGER | No | — | — |
| `requiresReview` | `requires_review` | boolean \| null | BOOLEAN | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `evidence_document_id` | [[evidence_documents]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `evidence_document_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/evidence-extractions.model.ts`](../../../../src/database/models/evidence-extractions.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154056-schema-relationships-part-2-privacy-consents.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
