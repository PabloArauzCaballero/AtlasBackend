---
title: "consent_documents"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Privacidad y consentimiento"
schema: "privacy"
table: "consent_documents"
orm_model: "ConsentDocumentModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/privacy"
source_files:
  - "src/database/models/consent-documents.model.ts"
aliases:
  - "ConsentDocumentModel"
---
# `privacy.consent_documents`

> [!info] Verificado
> Modelo ORM `ConsentDocumentModel` en [`src/database/models/consent-documents.model.ts`](../../../../src/database/models/consent-documents.model.ts). Esquema físico `privacy` resuelto por `atlasSchemaFor('consent_documents')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `privacy.consent_documents`
- **Modelo ORM:** `ConsentDocumentModel`
- **Dominio:** Privacidad y consentimiento → [[privacy-schema]]
- **Atributos:** 15 · **FK salientes:** 2 · **Referencias entrantes:** 1

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
| `documentCode` | `document_code` | string \| null | STRING(80) | No | — | — |
| `versionCode` | `version_code` | string \| null | STRING(40) | No | — | — |
| `language` | `language` | string \| null | STRING(10) | No | — | — |
| `effectiveFrom` | `effective_from` | string \| null | DATEONLY | No | — | — |
| `effectiveUntil` | `effective_until` | string \| null | DATEONLY | No | — | — |
| `contentUrl` | `content_url` | string \| null | TEXT | No | — | — |
| `contentHash` | `content_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `requiresExplicitAction` | `requires_explicit_action` | boolean \| null | BOOLEAN | No | — | — |
| `publishedByInternalUserId` | `published_by_internal_user_id` | string \| null | BIGINT | No | FK | — |
| `publishedAt` | `published_at` | Date \| null | DATE | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |

> [!warning] Datos sensibles
> 1 de 15 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `content_hash`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `published_by_internal_user_id` | [[internal_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[customer_consents]] | `consent_document_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `published_by_internal_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/consent-documents.model.ts`](../../../../src/database/models/consent-documents.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154056-schema-relationships-part-2-privacy-consents.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
