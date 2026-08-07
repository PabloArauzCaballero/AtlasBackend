---
title: "privacy_processing_purposes"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Privacidad y consentimiento"
schema: "privacy"
table: "privacy_processing_purposes"
orm_model: "PrivacyProcessingPurposeModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/privacy"
source_files:
  - "src/database/models/privacy-processing-purposes.model.ts"
aliases:
  - "PrivacyProcessingPurposeModel"
---
# `privacy.privacy_processing_purposes`

> [!info] Verificado
> Modelo ORM `PrivacyProcessingPurposeModel` en [`src/database/models/privacy-processing-purposes.model.ts`](../../../../../src/database/models/privacy-processing-purposes.model.ts). Esquema físico `privacy` resuelto por `atlasSchemaFor('privacy_processing_purposes')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `privacy.privacy_processing_purposes`
- **Modelo ORM:** `PrivacyProcessingPurposeModel`
- **Dominio:** Privacidad y consentimiento → [[privacy-schema]]
- **Atributos:** 9 · **FK salientes:** 0 · **Referencias entrantes:** 0

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`RIESGO` — la tabla **no** tiene `_tenant_id`: es global a la plataforma o el aislamiento depende de la tabla padre. Verificar antes de exponerla en un endpoint por tenant.

## Borrado lógico

`INFERIDO` — sin columna `_deleted`: el borrado es físico o la entidad es de solo-inserción (evento/log).

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `purposeCode` | `purpose_code` | string \| null | STRING(100) | No | — | — |
| `purposeName` | `purpose_name` | string \| null | STRING(180) | No | — | — |
| `legalBasis` | `legal_basis` | string \| null | STRING(160) | No | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `requiresExplicitConsent` | `requires_explicit_consent` | boolean \| null | BOOLEAN | No | — | — |
| `isActive` | `is_active` | boolean \| null | BOOLEAN | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| — | — | — | — | — |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `purpose_code` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/privacy-processing-purposes.model.ts`](../../../../../src/database/models/privacy-processing-purposes.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
