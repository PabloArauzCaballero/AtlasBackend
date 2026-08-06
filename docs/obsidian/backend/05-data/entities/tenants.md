---
title: "tenants"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
domain: "Identidad y acceso"
schema: "iam"
table: "tenants"
orm_model: "TenantModel"
tags:
  - "backend"
  - "data"
  - "entity"
  - "schema/iam"
source_files:
  - "src/database/models/tenants.model.ts"
aliases:
  - "TenantModel"
---
# `iam.tenants`

> [!info] Verificado
> Modelo ORM `TenantModel` en [`src/database/models/tenants.model.ts`](../../../../src/database/models/tenants.model.ts). Esquema físico `iam` resuelto por `atlasSchemaFor('tenants')` en [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts).

## Identidad

- **Tabla física:** `iam.tenants`
- **Modelo ORM:** `TenantModel`
- **Dominio:** Identidad y acceso → [[iam-schema]]
- **Atributos:** 8 · **FK salientes:** 0 · **Referencias entrantes:** 59

## Definición de negocio

Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.

## Multi-tenancy

`RIESGO` — la tabla **no** tiene `_tenant_id`: es global a la plataforma o el aislamiento depende de la tabla padre. Verificar antes de exponerla en un endpoint por tenant.

## Borrado lógico

`VERIFICADO` — usa borrado lógico vía `_deleted`. Las lecturas deben excluir `_deleted = true`.

## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|
| `id` | `_id` | string | BIGINT | Sí | PK | — |
| `tenantCode` | `tenant_code` | string \| null | STRING(60) | No | — | — |
| `legalName` | `legal_name` | string \| null | STRING(180) | No | — | — |
| `countryCode` | `country_code` | string \| null | STRING(3) | No | — | — |
| `status` | `status` | string \| null | STRING(40) | No | — | — |
| `createdAtValue` | `_created_at` | Date | DATE | Sí | — | — |
| `updatedAtValue` | `_updated_at` | Date \| null | DATE | No | — | — |
| `deleted` | `_deleted` | boolean \| null | BOOLEAN | No | — | — |



## Relaciones salientes

| Columna | Entidad destino | Columna destino | Cardinalidad | Al borrar el padre |
|---|---|---|---|---|
| — | — | — | — | — |

## Relaciones entrantes

| Entidad origen | Columna | Cardinalidad |
|---|---|---|
| [[internal_users]] | `_tenant_id` | 1..N obligatoria |
| [[data_provider_requests]] | `_tenant_id` | 1..N obligatoria |
| [[data_provider_responses]] | `_tenant_id` | 1..N obligatoria |
| [[customers]] | `_tenant_id` | 1..N obligatoria |
| [[customer_status_events]] | `_tenant_id` | 1..N obligatoria |
| [[customer_profile_versions]] | `_tenant_id` | 1..N obligatoria |
| [[customer_identity_documents]] | `_tenant_id` | 1..N obligatoria |
| [[identity_verification_attempts]] | `_tenant_id` | 1..N obligatoria |
| [[customer_contact_methods]] | `_tenant_id` | 1..N obligatoria |
| [[contact_verification_attempts]] | `_tenant_id` | 1..N obligatoria |
| [[customer_addresses]] | `_tenant_id` | 1..N obligatoria |
| [[customer_address_versions]] | `_tenant_id` | 1..N obligatoria |
| [[address_gps_observations]] | `_tenant_id` | 1..N obligatoria |
| [[customer_reference_contacts]] | `_tenant_id` | 1..N obligatoria |
| [[consent_documents]] | `_tenant_id` | 1..N obligatoria |
| [[customer_consents]] | `_tenant_id` | 1..N obligatoria |
| [[consent_events]] | `_tenant_id` | 1..N obligatoria |
| [[data_subject_requests]] | `_tenant_id` | 1..N obligatoria |
| [[evidence_documents]] | `_tenant_id` | 1..N obligatoria |
| [[evidence_extractions]] | `_tenant_id` | 1..N obligatoria |
| [[evidence_reviews]] | `_tenant_id` | 1..N obligatoria |
| [[devices]] | `_tenant_id` | 1..N obligatoria |
| [[customer_device_links]] | `_tenant_id` | 1..N obligatoria |
| [[device_snapshots]] | `_tenant_id` | 1..N obligatoria |
| [[device_risk_events]] | `_tenant_id` | 1..N obligatoria |
| [[sim_observations]] | `_tenant_id` | 1..N obligatoria |
| [[customer_sessions]] | `_tenant_id` | 1..N obligatoria |
| [[auth_events]] | `_tenant_id` | 1..N obligatoria |
| [[ip_reputation_observations]] | `_tenant_id` | 1..N obligatoria |
| [[customer_action_logs]] | `_tenant_id` | 1..N obligatoria |
| [[customer_activity_summaries]] | `_tenant_id` | 1..N obligatoria |
| [[onboarding_flows]] | `_tenant_id` | 1..N obligatoria |
| [[onboarding_step_events]] | `_tenant_id` | 1..N obligatoria |
| [[form_field_interaction_events]] | `_tenant_id` | 1..N obligatoria |
| [[permission_events]] | `_tenant_id` | 1..N obligatoria |
| [[onboarding_behavior_summaries]] | `_tenant_id` | 1..N obligatoria |
| [[on_device_computation_runs]] | `_tenant_id` | 1..N obligatoria |
| [[on_device_metric_values]] | `_tenant_id` | 1..N obligatoria |
| [[customer_observations]] | `_tenant_id` | 1..N obligatoria |
| [[customer_attribute_values]] | `_tenant_id` | 1..N obligatoria |
| [[customer_context_enrichments]] | `_tenant_id` | 1..N obligatoria |
| [[feature_computation_runs]] | `_tenant_id` | 1..N obligatoria |
| [[feature_values]] | `_tenant_id` | 1..N obligatoria |
| [[feature_lineage_links]] | `_tenant_id` | 1..N obligatoria |
| [[feature_snapshots]] | `_tenant_id` | 1..N obligatoria |
| [[risk_assessment_runs]] | `_tenant_id` | 1..N obligatoria |
| [[risk_assessment_contexts]] | `_tenant_id` | 1..N obligatoria |
| [[risk_rules_fired]] | `_tenant_id` | 1..N obligatoria |
| [[risk_feature_contributions]] | `_tenant_id` | 1..N obligatoria |
| [[risk_assessment_results]] | `_tenant_id` | 1..N obligatoria |
| [[manual_review_cases]] | `_tenant_id` | 1..N obligatoria |
| [[manual_review_events]] | `_tenant_id` | 1..N obligatoria |
| [[fraud_cases]] | `_tenant_id` | 1..N obligatoria |
| [[fraud_case_events]] | `_tenant_id` | 1..N obligatoria |
| [[watchlist_entries]] | `_tenant_id` | 0..N opcional |
| [[watchlist_matches]] | `_tenant_id` | 1..N obligatoria |
| [[data_change_logs]] | `_tenant_id` | 1..N obligatoria |
| [[operational_audit_logs]] | `_tenant_id` | 0..N opcional |
| [[data_quality_issues]] | `_tenant_id` | 0..N opcional |

## Índices y patrones de consulta

| Campos | Unicidad | Filtro parcial | Método |
|---|---|---|---|
| `tenant_code` | Único | `_deleted = false` | btree |



## Restricciones CHECK

`NO_CONFIRMADO` — no se detectaron CHECK declarados vía `addChecks` para esta tabla. Pueden existir CHECK creados con SQL crudo en otras migraciones.

## Evidencia y referencias

- Modelo: [`src/database/models/tenants.model.ts`](../../../../src/database/models/tenants.model.ts)
- Esquema: [`src/database/domain-schemas.ts`](../../../../src/database/domain-schemas.ts)


## Relaciones de la bóveda

- Pertenece a: [[05-data/schemas|Esquemas físicos]]
- Catálogo: [[15-reference/entity-catalog]]
- Diccionario: [[05-data/data-dictionary]]
