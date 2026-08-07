---
title: "data_quality_rules"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Auditoría y calidad"
schema: "audit"
table: "data_quality_rules"
orm_model: "DataQualityRuleModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/audit"
source_files:
  - "src/database/models/data-quality-rules.model.ts"
aliases:
  - "DataQualityRuleModel"
---
# `audit.data_quality_rules`

> [!info] Verificado
> Modelo ORM `DataQualityRuleModel` en [`src/database/models/data-quality-rules.model.ts`](../../../../../src/database/models/data-quality-rules.model.ts). Esquema físico `audit` resuelto por `atlasSchemaFor('data_quality_rules')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `audit.data_quality_rules`
- **Modelo ORM:** `DataQualityRuleModel`
- **Dominio:** Auditoría y calidad → [[audit-schema]]
- **Atributos:** 12 · **FK salientes:** 0 · **Referencias entrantes:** 1

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
| `ruleCode` | `rule_code` | string \| null | STRING(120) | No | — | — |
| `ruleName` | `rule_name` | string \| null | STRING(180) | No | — | — |
| `targetTable` | `target_table` | string \| null | STRING(120) | No | — | — |
| `targetField` | `target_field` | string \| null | STRING(120) | No | — | — |
| `severity` | `severity` | string \| null | STRING(40) | No | — | — |
| `expressionJson` | `expression_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `expectedAction` | `expected_action` | string \| null | STRING(80) | No | — | — |
| `buildPhase` | `build_phase` | string \| null | STRING(40) | No | — | — |
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
| [[data_quality_issues]] | `quality_rule_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `rule_code` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/data-quality-rules.model.ts`](../../../../../src/database/models/data-quality-rules.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
