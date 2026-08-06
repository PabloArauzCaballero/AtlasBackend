---
title: "retention_policies"
type: "data"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Privacidad y consentimiento"
schema: "privacy"
table: "retention_policies"
orm_model: "RetentionPolicyModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/privacy"
source_files:
  - "src/database/models/retention-policies.model.ts"
aliases:
  - "RetentionPolicyModel"
---
# `privacy.retention_policies`

> [!info] Verificado
> Modelo ORM `RetentionPolicyModel` en [`src/database/models/retention-policies.model.ts`](../../../../src/database/models/retention-policies.model.ts). Esquema físico `privacy` resuelto por `atlasSchemaFor('retention_policies')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `privacy.retention_policies`
- **Modelo ORM:** `RetentionPolicyModel`
- **Dominio:** Privacidad y consentimiento → [[privacy-schema]]
- **Atributos:** 10 · **FK salientes:** 0 · **Referencias entrantes:** 9

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
| `policyCode` | `policy_code` | string \| null | STRING(80) | No | — | — |
| `appliesTo` | `applies_to` | string \| null | STRING(80) | No | — | — |
| `retentionDays` | `retention_days` | number \| null | INTEGER | No | — | — |
| `postRetentionAction` | `post_retention_action` | string \| null | STRING(40) | No | — | — |
| `legalBasis` | `legal_basis` | string \| null | STRING(180) | No | — | — |
| `description` | `description` | string \| null | TEXT | No | — | — |
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
| [[data_providers]] | `default_retention_policy_id` | 0..N opcional |
| [[data_provider_responses]] | `retention_policy_id` | 0..N opcional |
| [[data_classification_policies]] | `default_retention_policy_id` | 0..N opcional |
| [[sensitive_field_rules]] | `retention_policy_id` | 0..N opcional |
| [[evidence_documents]] | `retention_policy_id` | 0..N opcional |
| [[observation_definitions]] | `retention_policy_id` | 0..N opcional |
| [[event_definitions]] | `retention_policy_id` | 0..N opcional |
| [[attribute_definitions]] | `retention_policy_id` | 0..N opcional |
| [[feature_definitions]] | `retention_policy_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `policy_code` | Único | — | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/retention-policies.model.ts`](../../../../src/database/models/retention-policies.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
