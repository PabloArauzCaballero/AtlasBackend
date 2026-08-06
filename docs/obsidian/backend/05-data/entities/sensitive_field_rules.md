---
title: "sensitive_field_rules"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Privacidad y consentimiento"
schema: "privacy"
table: "sensitive_field_rules"
orm_model: "SensitiveFieldRuleModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/privacy"
source_files:
  - "src/database/models/sensitive-field-rules.model.ts"
aliases:
  - "SensitiveFieldRuleModel"
---
# `privacy.sensitive_field_rules`

> [!info] Verificado
> Modelo ORM `SensitiveFieldRuleModel` en [`src/database/models/sensitive-field-rules.model.ts`](../../../../src/database/models/sensitive-field-rules.model.ts). Esquema físico `privacy` resuelto por `atlasSchemaFor('sensitive_field_rules')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `privacy.sensitive_field_rules`
- **Modelo ORM:** `SensitiveFieldRuleModel`
- **Dominio:** Privacidad y consentimiento → [[privacy-schema]]
- **Atributos:** 12 · **FK salientes:** 1 · **Referencias entrantes:** 0

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
| `tableName` | `table_name` | string \| null | STRING(120) | No | — | — |
| `fieldName` | `field_name` | string \| null | STRING(120) | No | — | — |
| `classificationCode` | `classification_code` | string \| null | STRING(80) | No | — | — |
| `storageMode` | `storage_mode` | string \| null | STRING(40) | No | — | — |
| `searchStrategy` | `search_strategy` | string \| null | STRING(40) | No | — | — |
| `maskingStrategy` | `masking_strategy` | string \| null | STRING(40) | No | — | — |
| `accessPolicyCode` | `access_policy_code` | string \| null | STRING(80) | No | — | — |
| `retentionPolicyId` | `retention_policy_id` | string \| null | BIGINT | No | FK | — |
| `isActive` | `is_active` | boolean \| null | BOOLEAN | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `retention_policy_id` | [[retention_policies]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| — | — | — | — |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `retention_policy_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/sensitive-field-rules.model.ts`](../../../../src/database/models/sensitive-field-rules.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154056-schema-relationships-part-2-privacy-consents.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
