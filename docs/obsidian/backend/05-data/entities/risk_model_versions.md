---
title: "risk_model_versions"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Riesgo y features"
schema: "risk"
table: "risk_model_versions"
orm_model: "RiskModelVersionModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/risk"
source_files:
  - "src/database/models/risk-model-versions.model.ts"
aliases:
  - "RiskModelVersionModel"
---
# `risk.risk_model_versions`

> [!info] Verificado
> Modelo ORM `RiskModelVersionModel` en [`src/database/models/risk-model-versions.model.ts`](../../../../src/database/models/risk-model-versions.model.ts). Esquema físico `risk` resuelto por `atlasSchemaFor('risk_model_versions')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `risk.risk_model_versions`
- **Modelo ORM:** `RiskModelVersionModel`
- **Dominio:** Riesgo y features → [[risk-schema]]
- **Atributos:** 13 · **FK salientes:** 1 · **Referencias entrantes:** 1

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
| `modelCode` | `model_code` | string \| null | STRING(80) | No | — | — |
| `versionCode` | `version_code` | string \| null | STRING(80) | No | — | — |
| `modelType` | `model_type` | string \| null | STRING(60) | No | — | — |
| `assessmentType` | `assessment_type` | string \| null | STRING(80) | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `effectiveFrom` | `effective_from` | Date \| null | DATE | No | — | — |
| `effectiveUntil` | `effective_until` | Date \| null | DATE | No | — | — |
| `approvedByPlatformUserId` | `approved_by_platform_user_id` | string \| null | BIGINT | No | FK | — |
| `approvedAt` | `approved_at` | Date \| null | DATE | No | — | — |
| `artifactUrl` | `artifact_url` | string \| null | TEXT | No | — | — |
| `artifactHash` | `artifact_hash` | string \| null | STRING(128) | No | — | PII hasheada |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |

> [!warning] Datos sensibles
> 1 de 13 atributos se clasifican como sensibles por convención de nombre (`INFERIDO`): `artifact_hash`. Ver [[05-data/sensitive-data]].

## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| `approved_by_platform_user_id` | [[platform_users]] | `_id` | Opcional (0..1) | `SET NULL` |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[risk_assessment_runs]] | `risk_model_version_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| — | — | — | — |

> [!warning] FK sin índice dedicado
> 1 columna(s) FK no encabezan ningún índice: `approved_by_platform_user_id`. En PostgreSQL una FK no crea índice en el lado hijo; los `JOIN` y la verificación de `RESTRICT` al borrar el padre harán *scan*. Riesgo estático sin medición — ver [[14-audits/risks-register#PERF-001]].

## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/risk-model-versions.model.ts`](../../../../src/database/models/risk-model-versions.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)
- Relaciones: `src/database/migrations/20260626154101-schema-relationships-part-7-risk-engine.ts`

## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
