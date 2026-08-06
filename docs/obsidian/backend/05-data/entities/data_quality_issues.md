---
title: "data_quality_issues"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Auditoría y calidad"
schema: "audit"
table: "data_quality_issues"
orm_model: "DataQualityIssueModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/audit"
source_files:
  - "src/database/models/data-quality-issues.model.ts"
aliases:
  - "DataQualityIssueModel"
---
# `audit.data_quality_issues`

> [!info] Verificado
> Modelo ORM `DataQualityIssueModel` en [`src/database/models/data-quality-issues.model.ts`](../../../../src/database/models/data-quality-issues.model.ts). Esquema físico `audit` resuelto por `atlasSchemaFor('data_quality_issues')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `audit.data_quality_issues`
- **Modelo ORM:** `DataQualityIssueModel`
- **Dominio:** Auditoría y calidad → [[audit-schema]]
- **Atributos:** 10 · **FK salientes:** 2 · **Referencias entrantes:** 0

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
| `tenantId` | `_tenant_id` | string \| null | BIGINT | No | FK | — |
| `qualityRuleId` | `quality_rule_id` | string \| null | BIGINT | No | FK | — |
| `targetTable` | `target_table` | string \| null | STRING(120) | No | — | — |
| `targetRecordId` | `target_record_id` | string \| null | STRING(120) | No | — | — |
| `issueStatus` | `issue_status` | string \| null | STRING(40) | No | — | — |
| `detectedAt` | `detected_at` | Date \| null | DATE | No | — | — |
| `resolvedAt` | `resolved_at` | Date \| null | DATE | No | — | — |
| `resolutionNotes` | `resolution_notes` | string \| null | TEXT | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `_tenant_id` | [[tenants]] | `_id` | Opcional (0..1) | `SET NULL` |
| `quality_rule_id` | [[data_quality_rules]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| — | — | — |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `_tenant_id` | No único | — | btree |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `quality_rule_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/data-quality-issues.model.ts`](../../../../src/database/models/data-quality-issues.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154103-schema-relationships-part-9-audit-quality.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
