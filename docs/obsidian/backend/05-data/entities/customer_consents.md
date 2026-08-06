---
title: "customer_consents"
type: "data"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Privacidad y consentimiento"
schema: "privacy"
table: "customer_consents"
orm_model: "CustomerConsentModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/privacy"
source_files:
  - "src/database/models/customer-consents.model.ts"
aliases:
  - "CustomerConsentModel"
---
# `privacy.customer_consents`

> [!info] Verificado
> Modelo ORM `CustomerConsentModel` en [`src/database/models/customer-consents.model.ts`](../../../../src/database/models/customer-consents.model.ts). Esquema físico `privacy` resuelto por `atlasSchemaFor('customer_consents')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `privacy.customer_consents`
- **Modelo ORM:** `CustomerConsentModel`
- **Dominio:** Privacidad y consentimiento → [[privacy-schema]]
- **Atributos:** 16 · **FK salientes:** 4 · **Referencias entrantes:** 4

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
| `consentDocumentId` | `consent_document_id` | string \| null | BIGINT | No | FK | — |
| `purposeCode` | `purpose_code` | string \| null | STRING(100) | No | — | — |
| `granted` | `granted` | boolean \| null | BOOLEAN | No | — | — |
| `grantedAt` | `granted_at` | Date \| null | DATE | No | — | — |
| `revokedAt` | `revoked_at` | Date \| null | DATE | No | — | — |
| `channel` | `channel` | string \| null | STRING(40) | No | — | — |
| `sessionId` | `session_id` | string \| null | BIGINT | No | FK | — |
| `ipAddress` | `ip_address` | string \| null | INET | No | — | PII |
| `deviceFingerprintSnapshot` | `device_fingerprint_snapshot` | string \| null | STRING(180) | No | — | — |
| `userAgent` | `user_agent` | string \| null | TEXT | No | — | — |
| `evidenceSnapshotUrl` | `evidence_snapshot_url` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |

> [!warning] Datos sensibles
> 1 de 16 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `ip_address`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `customer_id` | [[customers]] | `_id` | Opcional (0..1) | `SET NULL` |
| `consent_document_id` | [[consent_documents]] | `_id` | Opcional (0..1) | `SET NULL` |
| `session_id` | [[customer_sessions]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[data_provider_requests]] | `consent_id` | 0..N opcional |
| [[identity_verification_attempts]] | `consent_id` | 0..N opcional |
| [[consent_events]] | `customer_consent_id` | 0..N opcional |
| [[on_device_computation_runs]] | `consent_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `customer_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 2 columna(s) FK no encabezan ningún índice: `consent_document_id`, `session_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/customer-consents.model.ts`](../../../../src/database/models/customer-consents.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154056-schema-relationships-part-2-privacy-consents.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
