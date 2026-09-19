---
title: "risk_policy_rules"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "risk_policy_rules"
orm_model: "RiskPolicyRuleModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/risk-policy-rules.model.ts"
aliases:
  - "RiskPolicyRuleModel"
---
# `risk.risk_policy_rules`

> [!info] Verificado
> Modelo ORM `RiskPolicyRuleModel` en [`src/database/models/risk-policy-rules.model.ts`](../../../../../src/database/models/risk-policy-rules.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('risk_policy_rules')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.risk_policy_rules`
- **Modelo ORM:** `RiskPolicyRuleModel`
- **Dominio:** Riesgo y features → [[risk-schema]]
- **Atributos:** 12 · **FK salientes:** 1 · **Referencias entrantes:** 1

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
| `rulesetVersionId` | `ruleset_version_id` | string \| null | BIGINT | No | FK | — |
| `ruleCode` | `rule_code` | string \| null | STRING(120) | No | — | — |
| `ruleName` | `rule_name` | string \| null | STRING(180) | No | — | — |
| `riskDimension` | `risk_dimension` | string \| null | STRING(60) | No | — | — |
| `ruleType` | `rule_type` | string \| null | STRING(60) | No | — | — |
| `severity` | `severity` | string \| null | STRING(40) | No | — | — |
| `expressionJson` | `expression_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `actionCode` | `action_code` | string \| null | STRING(80) | No | — | — |
| `reasonCode` | `reason_code` | string \| null | STRING(100) | No | — | — |
| `isHardStop` | `is_hard_stop` | boolean \| null | BOOLEAN | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `ruleset_version_id` | [[risk_ruleset_versions]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[risk_rules_fired]] | `risk_policy_rule_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| — | — | — | — |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `ruleset_version_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/risk-policy-rules.model.ts`](../../../../../src/database/models/risk-policy-rules.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154101-schema-relationships-part-7-risk-engine.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
