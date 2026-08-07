---
title: "risk_rules_fired"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "risk_rules_fired"
orm_model: "RiskRuleFiredModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/risk-rules-fired.model.ts"
aliases:
  - "RiskRuleFiredModel"
---
# `risk.risk_rules_fired`

> [!info] Verificado
> Modelo ORM `RiskRuleFiredModel` en [`src/database/models/risk-rules-fired.model.ts`](../../../../../src/database/models/risk-rules-fired.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('risk_rules_fired')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.risk_rules_fired`
- **Modelo ORM:** `RiskRuleFiredModel`
- **Dominio:** Riesgo y features → [[risk-schema]]
- **Atributos:** 14 · **FK salientes:** 3 · **Referencias entrantes:** 0

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
| `riskAssessmentRunId` | `risk_assessment_run_id` | string \| null | BIGINT | No | FK | — |
| `riskPolicyRuleId` | `risk_policy_rule_id` | string \| null | BIGINT | No | FK | — |
| `ruleCodeSnapshot` | `rule_code_snapshot` | string \| null | STRING(120) | No | — | — |
| `rulesetVersionCodeSnapshot` | `ruleset_version_code_snapshot` | string \| null | STRING(80) | No | — | — |
| `riskDimension` | `risk_dimension` | string \| null | STRING(60) | No | — | — |
| `inputValuesJson` | `input_values_json` | Record<string, unknown> \| null | JSONB | No | — | — |
| `outputAction` | `output_action` | string \| null | STRING(80) | No | — | — |
| `reasonCode` | `reason_code` | string \| null | STRING(100) | No | — | — |
| `severity` | `severity` | string \| null | STRING(40) | No | — | — |
| `isHardStop` | `is_hard_stop` | boolean \| null | BOOLEAN | No | — | — |
| `firedAt` | `fired_at` | Date \| null | DATE | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Obligatoria (1..1) | `RESTRICT` |
| `risk_assessment_run_id` | [[risk_assessment_runs]] | `_id` | Opcional (0..1) | `SET NULL` |
| `risk_policy_rule_id` | [[risk_policy_rules]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |
| `risk_assessment_run_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `risk_policy_rule_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/risk-rules-fired.model.ts`](../../../../../src/database/models/risk-rules-fired.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154101-schema-relationships-part-7-risk-engine.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
