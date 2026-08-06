---
title: "data_classification_policies"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Privacidad y consentimiento"
schema: "privacy"
table: "data_classification_policies"
orm_model: "DataClassificationPolicyModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/privacy"
source_files:
  - "src/database/models/data-classification-policies.model.ts"
aliases:
  - "DataClassificationPolicyModel"
---
# `privacy.data_classification_policies`

> [!info] Verificado
> Modelo ORM `DataClassificationPolicyModel` en [`src/database/models/data-classification-policies.model.ts`](../../../../src/database/models/data-classification-policies.model.ts). Esquema físico `privacy` resuelto por `atlasSchemaFor('data_classification_policies')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `privacy.data_classification_policies`
- **Modelo ORM:** `DataClassificationPolicyModel`
- **Dominio:** Privacidad y consentimiento → [[privacy-schema]]
- **Atributos:** 13 · **FK salientes:** 1 · **Referencias entrantes:** 0

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
| `classificationCode` | `classification_code` | string \| null | STRING(80) | No | — | — |
| `classificationName` | `classification_name` | string \| null | STRING(160) | No | — | — |
| `sensitivityLevel` | `sensitivity_level` | string \| null | STRING(40) | No | — | — |
| `allowedStorageModesJson` | `allowed_storage_modes_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `defaultStorageMode` | `default_storage_mode` | string \| null | STRING(40) | No | — | — |
| `defaultRetentionPolicyId` | `default_retention_policy_id` | string \| null | BIGINT | No | FK | — |
| `encryptionRequired` | `encryption_required` | boolean \| null | BOOLEAN | No | — | — |
| `hashingRequired` | `hashing_required` | boolean \| null | BOOLEAN | No | — | — |
| `rawStorageAllowed` | `raw_storage_allowed` | boolean \| null | BOOLEAN | No | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `default_retention_policy_id` | [[retention_policies]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `classification_code` | Único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `default_retention_policy_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/data-classification-policies.model.ts`](../../../../src/database/models/data-classification-policies.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154056-schema-relationships-part-2-privacy-consents.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
