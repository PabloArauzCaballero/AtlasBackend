---
title: "system_operational_rule_catalog"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Operación de plataforma"
schema: "platform_ops"
table: "system_operational_rule_catalog"
orm_model: "SystemOperationalRuleCatalogModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/platform_ops"
source_files:
  - "src/database/models/system-operational-rule-catalog.model.ts"
aliases:
  - "SystemOperationalRuleCatalogModel"
---
# `platform_ops.system_operational_rule_catalog`

> [!info] Verificado
> Modelo ORM `SystemOperationalRuleCatalogModel` en [`src/database/models/system-operational-rule-catalog.model.ts`](../../../../../src/database/models/system-operational-rule-catalog.model.ts). Esquema físico `platform_ops` resuelto por `atlasSchemaFor('system_operational_rule_catalog')` en [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `platform_ops.system_operational_rule_catalog`
- **Modelo ORM:** `SystemOperationalRuleCatalogModel`
- **Dominio:** Operación de plataforma → [[platform_ops-schema]]
- **Atributos:** 22 · **FK salientes:** 0 · **Referencias entrantes:** 0

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
| `ruleCode` | `rule_code` | string | STRING(180) | Sí | — | — |
| `scopeType` | `scope_type` | string | STRING(40) | Sí | — | — |
| `schemaName` | `schema_name` | string | STRING(120) | Sí | — | — |
| `tableName` | `table_name` | string \| null | STRING(180) | No | — | — |
| `domainCode` | `domain_code` | string \| null | STRING(120) | No | — | — |
| `ruleType` | `rule_type` | string | STRING(40) | Sí | — | — |
| `ruleName` | `rule_name` | string | STRING(220) | Sí | — | — |
| `description` | `description` | string | TEXT | Sí | — | — |
| `businessReason` | `business_reason` | string \| null | TEXT | No | — | — |
| `technicalEnforcement` | `technical_enforcement` | string \| null | TEXT | No | — | — |
| `enforcementLayer` | `enforcement_layer` | string \| null | STRING(120) | No | — | — |
| `severity` | `severity` | string | STRING(20) | Sí | — | — |
| `expectedAction` | `expected_action` | string \| null | TEXT | No | — | — |
| `auditEvidence` | `audit_evidence` | string \| null | TEXT | No | — | — |
| `analysisValue` | `analysis_value` | string \| null | TEXT | No | — | — |
| `isActive` | `is_active` | boolean | BOOLEAN | Sí | — | — |
| `sourceDocument` | `source_document` | string | STRING(120) | Sí | — | — |
| `confidenceLevel` | `confidence_level` | string | STRING(20) | Sí | — | — |
| `reviewStatus` | `review_status` | string | STRING(40) | Sí | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date | DATE | Sí | — | — |



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
| `table_name` | No único | — | btree |
| `endpoint_code` | No único | — | btree |
| `domain_code` | No único | — | btree |
| `rule_type` | No único | — | btree |
| `table_name` | No único | — | btree |
| `domain_code` | No único | — | btree |
| `rule_type` | No único | — | btree |
| `severity` | No único | — | btree |
| `is_active` | No único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/system-operational-rule-catalog.model.ts`](../../../../../src/database/models/system-operational-rule-catalog.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
