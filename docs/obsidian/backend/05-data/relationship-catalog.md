---
title: "Catálogo de relaciones"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "data"
  - "relationships"
  - "catalog"
---
# Catálogo de relaciones

**244 claves foráneas**; **153** cruzan el límite de un esquema de dominio.

> [!info] Verificado — semántica de borrado derivada, no declarada
> `addForeignKeys` en [`src/database/migration-support/atlas-schema-builder.util.ts:177-197`](../../../src/database/migration-support/atlas-schema-builder.util.ts) fija la política **para todas** las FK del sistema:
> ```
> onUpdate: 'CASCADE'
> onDelete: allowNull ? 'SET NULL' : 'RESTRICT'
> ```
> No hay ninguna FK con `CASCADE` en borrado. Consecuencia: **una entidad padre con hijos obligatorios no se puede borrar físicamente**; el sistema depende del borrado lógico (`_deleted`) y de las políticas de retención. Ver [[05-data/retention-and-deletion]].

## Todas las relaciones

| Origen | Columna | Destino | Cardinalidad | Al borrar el padre | Cruza esquema |
|---|---|---|---|---|---|
| [[address_gps_observations]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[address_gps_observations]] | `address_version_id` | [[customer_address_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[address_gps_observations]] | `customer_address_id` | [[customer_addresses]] | 0..N → 0..1 | `SET NULL` | — |
| [[address_gps_observations]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | — |
| [[address_gps_observations]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `customer`→`telemetry` |
| [[attribute_definitions]] | `retention_policy_id` | [[retention_policies]] | 0..N → 0..1 | `SET NULL` | `catalog`→`privacy` |
| [[auth_events]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[auth_events]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[auth_events]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[auth_events]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | — |
| [[consent_documents]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `privacy`→`iam` |
| [[consent_documents]] | `published_by_internal_user_id` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `privacy`→`iam` |
| [[consent_events]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `privacy`→`iam` |
| [[consent_events]] | `customer_consent_id` | [[customer_consents]] | 0..N → 0..1 | `SET NULL` | — |
| [[consent_events]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `privacy`→`telemetry` |
| [[contact_verification_attempts]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[contact_verification_attempts]] | `contact_method_id` | [[customer_contact_methods]] | 0..N → 0..1 | `SET NULL` | — |
| [[contact_verification_attempts]] | `provider_request_id` | [[data_provider_requests]] | 0..N → 0..1 | `SET NULL` | `customer`→`integrations` |
| [[context_approval_events]] | `catalog_version_id` | [[context_catalog_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[context_approval_events]] | `decided_by_platform_user_id` | [[platform_users]] | 0..N → 0..1 | `SET NULL` | `catalog`→`iam` |
| [[context_approval_events]] | `staging_item_id` | [[context_staging_items]] | 0..N → 0..1 | `SET NULL` | — |
| [[context_catalog_versions]] | `approved_by_platform_user_id` | [[platform_users]] | 0..N → 0..1 | `SET NULL` | `catalog`→`iam` |
| [[context_catalog_versions]] | `catalog_id` | [[context_catalogs]] | 0..N → 0..1 | `SET NULL` | — |
| [[context_catalog_versions]] | `created_by_platform_user_id` | [[platform_users]] | 0..N → 0..1 | `SET NULL` | `catalog`→`iam` |
| [[context_item_aliases]] | `context_item_id` | [[context_items]] | 0..N → 0..1 | `SET NULL` | — |
| [[context_items]] | `catalog_version_id` | [[context_catalog_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[context_items]] | `source_id` | [[context_sources]] | 0..N → 0..1 | `SET NULL` | — |
| [[context_risk_mappings]] | `context_item_id` | [[context_items]] | 0..N → 0..1 | `SET NULL` | — |
| [[context_staging_items]] | `catalog_id` | [[context_catalogs]] | 0..N → 0..1 | `SET NULL` | — |
| [[context_staging_items]] | `created_by_platform_user_id` | [[platform_users]] | 0..N → 0..1 | `SET NULL` | `catalog`→`iam` |
| [[context_staging_items]] | `ingestion_job_id` | [[context_ingestion_jobs]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_action_logs]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[customer_action_logs]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[customer_action_logs]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_action_logs]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_activity_summaries]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[customer_activity_summaries]] | `customer_id` | [[customers]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`customer` |
| [[customer_activity_summaries]] | `first_device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_activity_summaries]] | `last_risk_assessment_id` | [[risk_assessment_results]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`risk` |
| [[customer_activity_summaries]] | `usual_device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_address_versions]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[customer_address_versions]] | `customer_address_id` | [[customer_addresses]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_address_versions]] | `evidence_id` | [[evidence_documents]] | 0..N → 0..1 | `SET NULL` | `customer`→`privacy` |
| [[customer_address_versions]] | `supersedes_version_id` | [[customer_address_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_addresses]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[customer_addresses]] | `current_version_id` | [[customer_address_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_addresses]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_attribute_values]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `catalog`→`iam` |
| [[customer_attribute_values]] | `attribute_definition_id` | [[attribute_definitions]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_attribute_values]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `catalog`→`customer` |
| [[customer_attribute_values]] | `evidence_id` | [[evidence_documents]] | 0..N → 0..1 | `SET NULL` | `catalog`→`privacy` |
| [[customer_consents]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `privacy`→`iam` |
| [[customer_consents]] | `consent_document_id` | [[consent_documents]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_consents]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `privacy`→`customer` |
| [[customer_consents]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `privacy`→`telemetry` |
| [[customer_contact_methods]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[customer_contact_methods]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_context_enrichments]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `catalog`→`iam` |
| [[customer_context_enrichments]] | `catalog_id` | [[context_catalogs]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_context_enrichments]] | `catalog_version_id` | [[context_catalog_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_context_enrichments]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `catalog`→`customer` |
| [[customer_context_enrichments]] | `matched_context_item_id` | [[context_items]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_context_enrichments]] | `observation_id` | [[customer_observations]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_device_links]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[customer_device_links]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[customer_device_links]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_device_links]] | `first_seen_session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_device_links]] | `last_seen_session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_identity_documents]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[customer_identity_documents]] | `back_evidence_id` | [[evidence_documents]] | 0..N → 0..1 | `SET NULL` | `customer`→`privacy` |
| [[customer_identity_documents]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_identity_documents]] | `front_evidence_id` | [[evidence_documents]] | 0..N → 0..1 | `SET NULL` | `customer`→`privacy` |
| [[customer_observations]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `catalog`→`iam` |
| [[customer_observations]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `catalog`→`customer` |
| [[customer_observations]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | `catalog`→`telemetry` |
| [[customer_observations]] | `evidence_id` | [[evidence_documents]] | 0..N → 0..1 | `SET NULL` | `catalog`→`privacy` |
| [[customer_observations]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `catalog`→`telemetry` |
| [[customer_observations]] | `source_provider_id` | [[data_providers]] | 0..N → 0..1 | `SET NULL` | `catalog`→`integrations` |
| [[customer_profile_versions]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[customer_profile_versions]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_profile_versions]] | `supersedes_version_id` | [[customer_profile_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_reference_contacts]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[customer_reference_contacts]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_sessions]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[customer_sessions]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[customer_sessions]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[customer_status_events]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[customer_status_events]] | `changed_by_internal_user_id` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `customer`→`iam` |
| [[customer_status_events]] | `changed_by_platform_user_id` | [[platform_users]] | 0..N → 0..1 | `SET NULL` | `customer`→`iam` |
| [[customer_status_events]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | — |
| [[customers]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[customers]] | `current_profile_version_id` | [[customer_profile_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[data_change_logs]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `audit`→`iam` |
| [[data_change_logs]] | `changed_by_internal_user_id` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `audit`→`iam` |
| [[data_change_logs]] | `changed_by_platform_user_id` | [[platform_users]] | 0..N → 0..1 | `SET NULL` | `audit`→`iam` |
| [[data_classification_policies]] | `default_retention_policy_id` | [[retention_policies]] | 0..N → 0..1 | `SET NULL` | — |
| [[data_provider_requests]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `integrations`→`iam` |
| [[data_provider_requests]] | `consent_id` | [[customer_consents]] | 0..N → 0..1 | `SET NULL` | `integrations`→`privacy` |
| [[data_provider_requests]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `integrations`→`customer` |
| [[data_provider_requests]] | `provider_id` | [[data_providers]] | 0..N → 0..1 | `SET NULL` | — |
| [[data_provider_requests]] | `risk_assessment_run_id` | [[risk_assessment_runs]] | 0..N → 0..1 | `SET NULL` | `integrations`→`risk` |
| [[data_provider_responses]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `integrations`→`iam` |
| [[data_provider_responses]] | `provider_request_id` | [[data_provider_requests]] | 0..N → 0..1 | `SET NULL` | — |
| [[data_provider_responses]] | `retention_policy_id` | [[retention_policies]] | 0..N → 0..1 | `SET NULL` | `integrations`→`privacy` |
| [[data_providers]] | `default_retention_policy_id` | [[retention_policies]] | 0..N → 0..1 | `SET NULL` | `integrations`→`privacy` |
| [[data_quality_issues]] | `_tenant_id` | [[tenants]] | 0..N → 0..1 | `SET NULL` | `audit`→`iam` |
| [[data_quality_issues]] | `quality_rule_id` | [[data_quality_rules]] | 0..N → 0..1 | `SET NULL` | — |
| [[data_subject_requests]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `privacy`→`iam` |
| [[data_subject_requests]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `privacy`→`customer` |
| [[data_subject_requests]] | `handled_by` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `privacy`→`iam` |
| [[device_risk_events]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[device_risk_events]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[device_snapshots]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[device_snapshots]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[device_snapshots]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[device_snapshots]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | — |
| [[devices]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[devices]] | `global_device_fingerprint_id` | [[global_device_fingerprints]] | 0..N → 0..1 | `SET NULL` | — |
| [[event_definitions]] | `retention_policy_id` | [[retention_policies]] | 0..N → 0..1 | `SET NULL` | `catalog`→`privacy` |
| [[evidence_documents]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `privacy`→`iam` |
| [[evidence_documents]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `privacy`→`customer` |
| [[evidence_documents]] | `retention_policy_id` | [[retention_policies]] | 0..N → 0..1 | `SET NULL` | — |
| [[evidence_documents]] | `uploaded_from_session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `privacy`→`telemetry` |
| [[evidence_extractions]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `privacy`→`iam` |
| [[evidence_extractions]] | `evidence_document_id` | [[evidence_documents]] | 0..N → 0..1 | `SET NULL` | — |
| [[evidence_reviews]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `privacy`→`iam` |
| [[evidence_reviews]] | `evidence_document_id` | [[evidence_documents]] | 0..N → 0..1 | `SET NULL` | — |
| [[evidence_reviews]] | `reviewed_by` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `privacy`→`iam` |
| [[feature_computation_runs]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `risk`→`iam` |
| [[feature_computation_runs]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `risk`→`customer` |
| [[feature_computation_runs]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[feature_computation_runs]] | `onboarding_flow_id` | [[onboarding_flows]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[feature_computation_runs]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[feature_definitions]] | `retention_policy_id` | [[retention_policies]] | 0..N → 0..1 | `SET NULL` | `risk`→`privacy` |
| [[feature_lineage_links]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `risk`→`iam` |
| [[feature_lineage_links]] | `feature_value_id` | [[feature_values]] | 0..N → 0..1 | `SET NULL` | — |
| [[feature_snapshots]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `risk`→`iam` |
| [[feature_snapshots]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `risk`→`customer` |
| [[feature_snapshots]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[feature_snapshots]] | `onboarding_flow_id` | [[onboarding_flows]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[feature_snapshots]] | `risk_assessment_run_id` | [[risk_assessment_runs]] | 0..N → 0..1 | `SET NULL` | — |
| [[feature_snapshots]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[feature_values]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `risk`→`iam` |
| [[feature_values]] | `computation_run_id` | [[feature_computation_runs]] | 0..N → 0..1 | `SET NULL` | — |
| [[feature_values]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `risk`→`customer` |
| [[feature_values]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[feature_values]] | `feature_definition_id` | [[feature_definitions]] | 0..N → 0..1 | `SET NULL` | — |
| [[feature_values]] | `onboarding_flow_id` | [[onboarding_flows]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[feature_values]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[form_field_interaction_events]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[form_field_interaction_events]] | `onboarding_flow_id` | [[onboarding_flows]] | 0..N → 0..1 | `SET NULL` | — |
| [[fraud_case_events]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `case_management`→`iam` |
| [[fraud_case_events]] | `actor_internal_user_id` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `case_management`→`iam` |
| [[fraud_case_events]] | `fraud_case_id` | [[fraud_cases]] | 0..N → 0..1 | `SET NULL` | — |
| [[fraud_cases]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `case_management`→`iam` |
| [[fraud_cases]] | `assigned_to_internal_user_id` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `case_management`→`iam` |
| [[fraud_cases]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `case_management`→`customer` |
| [[fraud_cases]] | `escalated_from_review_case_id` | [[manual_review_cases]] | 0..N → 0..1 | `SET NULL` | — |
| [[fraud_cases]] | `primary_device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | `case_management`→`telemetry` |
| [[identity_verification_attempts]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `customer`→`iam` |
| [[identity_verification_attempts]] | `consent_id` | [[customer_consents]] | 0..N → 0..1 | `SET NULL` | `customer`→`privacy` |
| [[identity_verification_attempts]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | — |
| [[identity_verification_attempts]] | `identity_document_id` | [[customer_identity_documents]] | 0..N → 0..1 | `SET NULL` | — |
| [[identity_verification_attempts]] | `manual_reviewed_by` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `customer`→`iam` |
| [[identity_verification_attempts]] | `provider_request_id` | [[data_provider_requests]] | 0..N → 0..1 | `SET NULL` | `customer`→`integrations` |
| [[identity_verification_attempts]] | `selfie_evidence_id` | [[evidence_documents]] | 0..N → 0..1 | `SET NULL` | `customer`→`privacy` |
| [[internal_users]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | — |
| [[ip_reputation_observations]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[ip_reputation_observations]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[ip_reputation_observations]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[ip_reputation_observations]] | `provider_request_id` | [[data_provider_requests]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`integrations` |
| [[ip_reputation_observations]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | — |
| [[manual_review_cases]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `case_management`→`iam` |
| [[manual_review_cases]] | `assigned_to_internal_user_id` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `case_management`→`iam` |
| [[manual_review_cases]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `case_management`→`customer` |
| [[manual_review_cases]] | `fraud_case_id` | [[fraud_cases]] | 0..N → 0..1 | `SET NULL` | — |
| [[manual_review_cases]] | `risk_assessment_run_id` | [[risk_assessment_runs]] | 0..N → 0..1 | `SET NULL` | `case_management`→`risk` |
| [[manual_review_events]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `case_management`→`iam` |
| [[manual_review_events]] | `actor_internal_user_id` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `case_management`→`iam` |
| [[manual_review_events]] | `manual_review_case_id` | [[manual_review_cases]] | 0..N → 0..1 | `SET NULL` | — |
| [[observation_definitions]] | `retention_policy_id` | [[retention_policies]] | 0..N → 0..1 | `SET NULL` | `catalog`→`privacy` |
| [[on_device_computation_runs]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[on_device_computation_runs]] | `consent_id` | [[customer_consents]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`privacy` |
| [[on_device_computation_runs]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[on_device_computation_runs]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[on_device_computation_runs]] | `onboarding_flow_id` | [[onboarding_flows]] | 0..N → 0..1 | `SET NULL` | — |
| [[on_device_computation_runs]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | — |
| [[on_device_metric_values]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[on_device_metric_values]] | `computation_run_id` | [[on_device_computation_runs]] | 0..N → 0..1 | `SET NULL` | — |
| [[onboarding_behavior_summaries]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[onboarding_behavior_summaries]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[onboarding_behavior_summaries]] | `onboarding_flow_id` | [[onboarding_flows]] | 0..N → 0..1 | `SET NULL` | — |
| [[onboarding_flows]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[onboarding_flows]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[onboarding_flows]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | — |
| [[onboarding_step_events]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[onboarding_step_events]] | `onboarding_flow_id` | [[onboarding_flows]] | 0..N → 0..1 | `SET NULL` | — |
| [[operational_audit_logs]] | `_tenant_id` | [[tenants]] | 0..N → 0..1 | `SET NULL` | `audit`→`iam` |
| [[operational_audit_logs]] | `actor_internal_user_id` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `audit`→`iam` |
| [[operational_audit_logs]] | `actor_platform_user_id` | [[platform_users]] | 0..N → 0..1 | `SET NULL` | `audit`→`iam` |
| [[permission_events]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[permission_events]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[permission_events]] | `onboarding_flow_id` | [[onboarding_flows]] | 0..N → 0..1 | `SET NULL` | — |
| [[permission_events]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_assessment_contexts]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `risk`→`iam` |
| [[risk_assessment_contexts]] | `risk_assessment_run_id` | [[risk_assessment_runs]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_assessment_results]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `risk`→`iam` |
| [[risk_assessment_results]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `risk`→`customer` |
| [[risk_assessment_results]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[risk_assessment_results]] | `feature_snapshot_id` | [[feature_snapshots]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_assessment_results]] | `onboarding_flow_id` | [[onboarding_flows]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[risk_assessment_results]] | `risk_assessment_run_id` | [[risk_assessment_runs]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_assessment_results]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[risk_assessment_runs]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `risk`→`iam` |
| [[risk_assessment_runs]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `risk`→`customer` |
| [[risk_assessment_runs]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[risk_assessment_runs]] | `feature_snapshot_id` | [[feature_snapshots]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_assessment_runs]] | `onboarding_flow_id` | [[onboarding_flows]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[risk_assessment_runs]] | `risk_model_version_id` | [[risk_model_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_assessment_runs]] | `risk_ruleset_version_id` | [[risk_ruleset_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_assessment_runs]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `risk`→`telemetry` |
| [[risk_feature_contributions]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `risk`→`iam` |
| [[risk_feature_contributions]] | `risk_assessment_run_id` | [[risk_assessment_runs]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_model_versions]] | `approved_by_platform_user_id` | [[platform_users]] | 0..N → 0..1 | `SET NULL` | `risk`→`iam` |
| [[risk_policy_rules]] | `ruleset_version_id` | [[risk_ruleset_versions]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_rules_fired]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `risk`→`iam` |
| [[risk_rules_fired]] | `risk_assessment_run_id` | [[risk_assessment_runs]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_rules_fired]] | `risk_policy_rule_id` | [[risk_policy_rules]] | 0..N → 0..1 | `SET NULL` | — |
| [[risk_ruleset_versions]] | `approved_by_platform_user_id` | [[platform_users]] | 0..N → 0..1 | `SET NULL` | `risk`→`iam` |
| [[sensitive_field_rules]] | `retention_policy_id` | [[retention_policies]] | 0..N → 0..1 | `SET NULL` | — |
| [[sim_observations]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `telemetry`→`iam` |
| [[sim_observations]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `telemetry`→`customer` |
| [[sim_observations]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | — |
| [[sim_observations]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | — |
| [[watchlist_entries]] | `_tenant_id` | [[tenants]] | 0..N → 0..1 | `SET NULL` | `case_management`→`iam` |
| [[watchlist_entries]] | `created_by_internal_user_id` | [[internal_users]] | 0..N → 0..1 | `SET NULL` | `case_management`→`iam` |
| [[watchlist_entries]] | `created_by_platform_user_id` | [[platform_users]] | 0..N → 0..1 | `SET NULL` | `case_management`→`iam` |
| [[watchlist_matches]] | `_tenant_id` | [[tenants]] | 1..N → 1..1 | `RESTRICT` | `case_management`→`iam` |
| [[watchlist_matches]] | `customer_id` | [[customers]] | 0..N → 0..1 | `SET NULL` | `case_management`→`customer` |
| [[watchlist_matches]] | `device_id` | [[devices]] | 0..N → 0..1 | `SET NULL` | `case_management`→`telemetry` |
| [[watchlist_matches]] | `opened_fraud_case_id` | [[fraud_cases]] | 0..N → 0..1 | `SET NULL` | — |
| [[watchlist_matches]] | `opened_review_case_id` | [[manual_review_cases]] | 0..N → 0..1 | `SET NULL` | — |
| [[watchlist_matches]] | `session_id` | [[customer_sessions]] | 0..N → 0..1 | `SET NULL` | `case_management`→`telemetry` |
| [[watchlist_matches]] | `watchlist_entry_id` | [[watchlist_entries]] | 0..N → 0..1 | `SET NULL` | — |

## Tablas más referenciadas

| Entidad | Referencias entrantes | Lectura |
|---|---:|---|
| [[tenants]] | 59 | Nodo central: cualquier cambio de forma impacta a decenas de tablas |
| [[customers]] | 35 | Nodo central: cualquier cambio de forma impacta a decenas de tablas |
| [[customer_sessions]] | 21 | Nodo central: cualquier cambio de forma impacta a decenas de tablas |
| [[devices]] | 19 | Entidad de referencia |
| [[internal_users]] | 12 | Entidad de referencia |
| [[platform_users]] | 10 | Entidad de referencia |
| [[onboarding_flows]] | 10 | Entidad de referencia |
| [[retention_policies]] | 9 | Entidad de referencia |
| [[evidence_documents]] | 8 | Entidad de referencia |
| [[risk_assessment_runs]] | 7 | Entidad de referencia |
| [[customer_consents]] | 4 | Entidad de referencia |
| [[data_provider_requests]] | 4 | Entidad de referencia |
| [[customer_address_versions]] | 3 | Entidad de referencia |
| [[context_catalogs]] | 3 | Entidad de referencia |
| [[context_catalog_versions]] | 3 | Entidad de referencia |

## Relaciones sin constraint física

`NO_CONFIRMADO` — este catálogo solo recoge FK declaradas. Las relaciones lógicas sin FK (por ejemplo punteros polimórficos como `target_type`/`target_id` en `system_catalog_review_events`) **no** están cubiertas por integridad referencial y no aparecen aquí. Ver [[14-audits/risks-register#DATA-002]].
