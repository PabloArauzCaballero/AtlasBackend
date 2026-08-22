---
title: "Catálogo de entidades"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "reference"
  - "data"
  - "catalog"
---
# Catálogo de entidades

**130 tablas** en **12 esquemas físicos**, **2040 atributos** y **244 claves foráneas**.

| Entidad | Esquema | Dominio | Modelo ORM | Atributos | Tenant | Soft-delete |
|---|---|---|---|---|---|---|
| [[data_change_logs]] | `audit` | Auditoría y calidad | `DataChangeLogModel` | 13 | Sí | — |
| [[data_quality_issues]] | `audit` | Auditoría y calidad | `DataQualityIssueModel` | 10 | Sí | — |
| [[data_quality_rules]] | `audit` | Auditoría y calidad | `DataQualityRuleModel` | 12 | — | — |
| [[operational_audit_logs]] | `audit` | Auditoría y calidad | `OperationalAuditLogModel` | 13 | Sí | — |
| [[schema_constraint_notes]] | `audit` | Auditoría y calidad | `SchemaConstraintNoteModel` | 9 | — | — |
| [[fraud_case_events]] | `case_management` | Gestión de casos y fraude | `FraudCaseEventModel` | 10 | Sí | — |
| [[fraud_cases]] | `case_management` | Gestión de casos y fraude | `FraudCaseModel` | 20 | Sí | Sí |
| [[manual_review_cases]] | `case_management` | Gestión de casos y fraude | `ManualReviewCaseModel` | 17 | Sí | Sí |
| [[manual_review_events]] | `case_management` | Gestión de casos y fraude | `ManualReviewEventModel` | 10 | Sí | — |
| [[watchlist_entries]] | `case_management` | Gestión de casos y fraude | `WatchlistEntryModel` | 18 | Sí | Sí |
| [[watchlist_matches]] | `case_management` | Gestión de casos y fraude | `WatchlistMatchModel` | 14 | Sí | — |
| [[attribute_definitions]] | `catalog` | Catálogo y contexto | `AttributeDefinitionModel` | 25 | — | — |
| [[context_approval_events]] | `catalog` | Catálogo y contexto | `ContextApprovalEventModel` | 8 | — | — |
| [[context_catalog_versions]] | `catalog` | Catálogo y contexto | `ContextCatalogVersionModel` | 13 | — | — |
| [[context_catalogs]] | `catalog` | Catálogo y contexto | `ContextCatalogModel` | 9 | — | — |
| [[context_ingestion_jobs]] | `catalog` | Catálogo y contexto | `ContextIngestionJobModel` | 11 | — | — |
| [[context_item_aliases]] | `catalog` | Catálogo y contexto | `ContextItemAliasModel` | 7 | — | — |
| [[context_items]] | `catalog` | Catálogo y contexto | `ContextItemModel` | 11 | — | — |
| [[context_risk_mappings]] | `catalog` | Catálogo y contexto | `ContextRiskMappingModel` | 13 | — | — |
| [[context_sources]] | `catalog` | Catálogo y contexto | `ContextSourceModel` | 10 | — | — |
| [[context_staging_items]] | `catalog` | Catálogo y contexto | `ContextStagingItemModel` | 13 | — | — |
| [[customer_attribute_values]] | `catalog` | Catálogo y contexto | `CustomerAttributeValueModel` | 15 | Sí | — |
| [[customer_context_enrichments]] | `catalog` | Catálogo y contexto | `CustomerContextEnrichmentModel` | 16 | Sí | — |
| [[customer_observations]] | `catalog` | Catálogo y contexto | `CustomerObservationModel` | 21 | Sí | — |
| [[event_definitions]] | `catalog` | Catálogo y contexto | `EventDefinitionModel` | 18 | — | — |
| [[observation_definitions]] | `catalog` | Catálogo y contexto | `ObservationDefinitionModel` | 22 | — | — |
| [[credit_application_events]] | `credit` | Crédito | `CreditApplicationEventModel` | 13 | Sí | — |
| [[credit_applications]] | `credit` | Crédito | `CreditApplicationModel` | 21 | Sí | Sí |
| [[credit_products]] | `credit` | Crédito | `CreditProductModel` | 20 | Sí | Sí |
| [[address_gps_observations]] | `customer` | Clientes e identidad | `AddressGpsObservationModel` | 13 | Sí | — |
| [[contact_verification_attempts]] | `customer` | Clientes e identidad | `ContactVerificationAttemptModel` | 11 | Sí | — |
| [[customer_address_versions]] | `customer` | Clientes e identidad | `CustomerAddressVersionModel` | 19 | Sí | — |
| [[customer_addresses]] | `customer` | Clientes e identidad | `CustomerAddressModel` | 11 | Sí | Sí |
| [[customer_contact_methods]] | `customer` | Clientes e identidad | `CustomerContactMethodModel` | 18 | Sí | Sí |
| [[customer_eligibility_evaluations]] | `customer` | Clientes e identidad | `CustomerEligibilityEvaluationModel` | 15 | Sí | — |
| [[customer_identity_documents]] | `customer` | Clientes e identidad | `CustomerIdentityDocumentModel` | 23 | Sí | — |
| [[customer_profile_versions]] | `customer` | Clientes e identidad | `CustomerProfileVersionModel` | 16 | Sí | — |
| [[customer_reference_contacts]] | `customer` | Clientes e identidad | `CustomerReferenceContactModel` | 17 | Sí | Sí |
| [[customer_status_events]] | `customer` | Clientes e identidad | `CustomerStatusEventModel` | 12 | Sí | — |
| [[customers]] | `customer` | Clientes e identidad | `CustomerModel` | 18 | Sí | Sí |
| [[identity_verification_attempts]] | `customer` | Clientes e identidad | `IdentityVerificationAttemptModel` | 19 | Sí | — |
| [[auth_credentials]] | `iam` | Identidad y acceso | `AuthCredentialModel` | 14 | Sí | Sí |
| [[auth_one_time_codes]] | `iam` | Identidad y acceso | `AuthOneTimeCodeModel` | 11 | Sí | — |
| [[auth_refresh_tokens]] | `iam` | Identidad y acceso | `AuthRefreshTokenModel` | 13 | Sí | — |
| [[internal_permissions]] | `iam` | Identidad y acceso | `InternalPermissionModel` | 14 | — | Sí |
| [[internal_role_permissions]] | `iam` | Identidad y acceso | `InternalRolePermissionModel` | 5 | — | — |
| [[internal_roles]] | `iam` | Identidad y acceso | `InternalRoleModel` | 11 | — | Sí |
| [[internal_user_roles]] | `iam` | Identidad y acceso | `InternalUserRoleModel` | 11 | Sí | — |
| [[internal_users]] | `iam` | Identidad y acceso | `InternalUserModel` | 18 | Sí | Sí |
| [[platform_users]] | `iam` | Identidad y acceso | `PlatformUserModel` | 9 | — | Sí |
| [[tenants]] | `iam` | Identidad y acceso | `TenantModel` | 8 | — | Sí |
| [[data_provider_requests]] | `integrations` | Integraciones externas | `DataProviderRequestModel` | 29 | Sí | — |
| [[data_provider_responses]] | `integrations` | Integraciones externas | `DataProviderResponseModel` | 15 | Sí | — |
| [[data_providers]] | `integrations` | Integraciones externas | `DataProviderModel` | 17 | — | — |
| [[external_oauth_connections]] | `integrations` | Integraciones externas | `ExternalOauthConnectionModel` | 16 | Sí | — |
| [[external_provider_cost_policies]] | `integrations` | Integraciones externas | `ExternalProviderCostPolicyModel` | 22 | — | — |
| [[provider_health_logs]] | `integrations` | Integraciones externas | `ProviderHealthLogModel` | 9 | — | — |
| [[device_tokens]] | `messaging` | Mensajería y notificaciones | `DeviceTokenModel` | 12 | Sí | — |
| [[notification_deliveries]] | `messaging` | Mensajería y notificaciones | `NotificationDeliveryModel` | 16 | Sí | — |
| [[notification_messages]] | `messaging` | Mensajería y notificaciones | `NotificationMessageModel` | 28 | Sí | — |
| [[notification_templates]] | `messaging` | Mensajería y notificaciones | `NotificationTemplateModel` | 15 | Sí | — |
| [[user_notification_preferences]] | `messaging` | Mensajería y notificaciones | `UserNotificationPreferenceModel` | 9 | Sí | — |
| [[idempotency_keys]] | `platform_ops` | Operación de plataforma | `IdempotencyKeyModel` | 14 | — | — |
| [[outbox_events]] | `platform_ops` | Operación de plataforma | `OutboxEventModel` | 27 | Sí | — |
| [[system_action_logs]] | `platform_ops` | Operación de plataforma | `SystemActionLogModel` | 34 | Sí | — |
| [[system_catalog_review_events]] | `platform_ops` | Operación de plataforma | `SystemCatalogReviewEventModel` | 12 | Sí | — |
| [[system_data_field_catalog]] | `platform_ops` | Operación de plataforma | `SystemDataFieldCatalogModel` | 60 | — | — |
| [[system_data_relationship_catalog]] | `platform_ops` | Operación de plataforma | `SystemDataRelationshipCatalogModel` | 24 | — | — |
| [[system_domain_catalog]] | `platform_ops` | Operación de plataforma | `SystemDomainCatalogModel` | 16 | — | — |
| [[system_endpoint_catalog]] | `platform_ops` | Operación de plataforma | `SystemEndpointCatalogModel` | 42 | — | — |
| [[system_endpoint_data_entity_impacts]] | `platform_ops` | Operación de plataforma | `SystemEndpointDataEntityImpactModel` | 23 | — | — |
| [[system_endpoint_field_impacts]] | `platform_ops` | Operación de plataforma | `SystemEndpointFieldImpactModel` | 16 | — | — |
| [[system_endpoint_payload_contracts]] | `platform_ops` | Operación de plataforma | `SystemEndpointPayloadContractModel` | 16 | — | — |
| [[system_endpoint_tool_requirements]] | `platform_ops` | Operación de plataforma | `SystemEndpointToolRequirementModel` | 15 | — | — |
| [[system_job_runs]] | `platform_ops` | Operación de plataforma | `SystemJobRunModel` | 12 | Sí | — |
| [[system_operational_rule_catalog]] | `platform_ops` | Operación de plataforma | `SystemOperationalRuleCatalogModel` | 22 | — | — |
| [[system_stress_profiles]] | `platform_ops` | Operación de plataforma | `SystemStressProfileModel` | 18 | — | — |
| [[system_test_runs]] | `platform_ops` | Operación de plataforma | `SystemTestRunModel` | 13 | Sí | — |
| [[system_test_step_runs]] | `platform_ops` | Operación de plataforma | `SystemTestStepRunModel` | 10 | — | — |
| [[system_test_steps]] | `platform_ops` | Operación de plataforma | `SystemTestStepModel` | 17 | — | — |
| [[system_test_suites]] | `platform_ops` | Operación de plataforma | `SystemTestSuiteModel` | 15 | — | — |
| [[system_tool_catalog]] | `platform_ops` | Operación de plataforma | `SystemToolCatalogModel` | 16 | — | — |
| [[workflow_definitions]] | `platform_ops` | Operación de plataforma | `WorkflowDefinitionModel` | 22 | — | Sí |
| [[workflow_stages]] | `platform_ops` | Operación de plataforma | `WorkflowStageModel` | 20 | — | Sí |
| [[workflow_step_dependencies]] | `platform_ops` | Operación de plataforma | `WorkflowStepDependencyModel` | 8 | — | — |
| [[workflow_steps]] | `platform_ops` | Operación de plataforma | `WorkflowStepModel` | 32 | — | Sí |
| [[workflow_transitions]] | `platform_ops` | Operación de plataforma | `WorkflowTransitionModel` | 12 | — | — |
| [[consent_documents]] | `privacy` | Privacidad y consentimiento | `ConsentDocumentModel` | 15 | Sí | — |
| [[consent_events]] | `privacy` | Privacidad y consentimiento | `ConsentEventModel` | 13 | Sí | — |
| [[customer_consents]] | `privacy` | Privacidad y consentimiento | `CustomerConsentModel` | 16 | Sí | — |
| [[data_classification_policies]] | `privacy` | Privacidad y consentimiento | `DataClassificationPolicyModel` | 13 | — | — |
| [[data_subject_requests]] | `privacy` | Privacidad y consentimiento | `DataSubjectRequestModel` | 14 | Sí | Sí |
| [[evidence_documents]] | `privacy` | Privacidad y consentimiento | `EvidenceDocumentModel` | 20 | Sí | Sí |
| [[evidence_extractions]] | `privacy` | Privacidad y consentimiento | `EvidenceExtractionModel` | 12 | Sí | — |
| [[evidence_reviews]] | `privacy` | Privacidad y consentimiento | `EvidenceReviewModel` | 10 | Sí | — |
| [[privacy_processing_purposes]] | `privacy` | Privacidad y consentimiento | `PrivacyProcessingPurposeModel` | 9 | — | — |
| [[retention_policies]] | `privacy` | Privacidad y consentimiento | `RetentionPolicyModel` | 10 | — | — |
| [[sensitive_field_rules]] | `privacy` | Privacidad y consentimiento | `SensitiveFieldRuleModel` | 12 | — | — |
| [[feature_computation_runs]] | `risk` | Riesgo y features | `FeatureComputationRunModel` | 20 | Sí | — |
| [[feature_definitions]] | `risk` | Riesgo y features | `FeatureDefinitionModel` | 26 | — | — |
| [[feature_lineage_links]] | `risk` | Riesgo y features | `FeatureLineageLinkModel` | 10 | Sí | — |
| [[feature_snapshots]] | `risk` | Riesgo y features | `FeatureSnapshotModel` | 18 | Sí | — |
| [[feature_values]] | `risk` | Riesgo y features | `FeatureValueModel` | 20 | Sí | — |
| [[risk_assessment_contexts]] | `risk` | Riesgo y features | `RiskAssessmentContextModel` | 24 | Sí | — |
| [[risk_assessment_results]] | `risk` | Riesgo y features | `RiskAssessmentResultModel` | 26 | Sí | — |
| [[risk_assessment_runs]] | `risk` | Riesgo y features | `RiskAssessmentRunModel` | 19 | Sí | — |
| [[risk_feature_contributions]] | `risk` | Riesgo y features | `RiskFeatureContributionModel` | 10 | Sí | — |
| [[risk_model_versions]] | `risk` | Riesgo y features | `RiskModelVersionModel` | 13 | — | — |
| [[risk_policy_rules]] | `risk` | Riesgo y features | `RiskPolicyRuleModel` | 12 | — | — |
| [[risk_rules_fired]] | `risk` | Riesgo y features | `RiskRuleFiredModel` | 14 | Sí | — |
| [[risk_ruleset_versions]] | `risk` | Riesgo y features | `RiskRulesetVersionModel` | 10 | — | — |
| [[risk_signal_seeds]] | `risk` | Riesgo y features | `RiskSignalSeedModel` | 15 | — | — |
| [[auth_events]] | `telemetry` | Telemetría, dispositivos y sesiones | `AuthEventModel` | 11 | Sí | — |
| [[customer_action_logs]] | `telemetry` | Telemetría, dispositivos y sesiones | `CustomerActionLogModel` | 10 | Sí | — |
| [[customer_activity_summaries]] | `telemetry` | Telemetría, dispositivos y sesiones | `CustomerActivitySummaryModel` | 20 | Sí | — |
| [[customer_device_links]] | `telemetry` | Telemetría, dispositivos y sesiones | `CustomerDeviceLinkModel` | 14 | Sí | Sí |
| [[customer_sessions]] | `telemetry` | Telemetría, dispositivos y sesiones | `CustomerSessionModel` | 16 | Sí | — |
| [[device_risk_events]] | `telemetry` | Telemetría, dispositivos y sesiones | `DeviceRiskEventModel` | 10 | Sí | — |
| [[device_snapshots]] | `telemetry` | Telemetría, dispositivos y sesiones | `DeviceSnapshotModel` | 20 | Sí | — |
| [[devices]] | `telemetry` | Telemetría, dispositivos y sesiones | `DeviceModel` | 12 | Sí | Sí |
| [[form_field_interaction_events]] | `telemetry` | Telemetría, dispositivos y sesiones | `FormFieldInteractionEventModel` | 10 | Sí | — |
| [[global_device_fingerprints]] | `telemetry` | Telemetría, dispositivos y sesiones | `GlobalDeviceFingerprintModel` | 9 | — | — |
| [[ip_reputation_observations]] | `telemetry` | Telemetría, dispositivos y sesiones | `IpReputationObservationModel` | 15 | Sí | — |
| [[on_device_computation_runs]] | `telemetry` | Telemetría, dispositivos y sesiones | `OnDeviceComputationRunModel` | 16 | Sí | — |
| [[on_device_metric_values]] | `telemetry` | Telemetría, dispositivos y sesiones | `OnDeviceMetricValueModel` | 10 | Sí | — |
| [[onboarding_behavior_summaries]] | `telemetry` | Telemetría, dispositivos y sesiones | `OnboardingBehaviorSummaryModel` | 15 | Sí | — |
| [[onboarding_flows]] | `telemetry` | Telemetría, dispositivos y sesiones | `OnboardingFlowModel` | 11 | Sí | — |
| [[onboarding_step_events]] | `telemetry` | Telemetría, dispositivos y sesiones | `OnboardingStepEventModel` | 11 | Sí | — |
| [[permission_events]] | `telemetry` | Telemetría, dispositivos y sesiones | `PermissionEventModel` | 10 | Sí | — |
| [[sim_observations]] | `telemetry` | Telemetría, dispositivos y sesiones | `SimObservationModel` | 17 | Sí | — |

## Distribución por esquema

| Esquema | Dominio | Tablas |
|---|---|---:|
| [[platform_ops-schema\|platform_ops]] | Operación de plataforma | 25 |
| [[telemetry-schema\|telemetry]] | Telemetría, dispositivos y sesiones | 18 |
| [[catalog-schema\|catalog]] | Catálogo y contexto | 15 |
| [[risk-schema\|risk]] | Riesgo y features | 14 |
| [[customer-schema\|customer]] | Clientes e identidad | 12 |
| [[privacy-schema\|privacy]] | Privacidad y consentimiento | 11 |
| [[iam-schema\|iam]] | Identidad y acceso | 10 |
| [[integrations-schema\|integrations]] | Integraciones externas | 6 |
| [[case_management-schema\|case_management]] | Gestión de casos y fraude | 6 |
| [[audit-schema\|audit]] | Auditoría y calidad | 5 |
| [[messaging-schema\|messaging]] | Mensajería y notificaciones | 5 |
| [[credit-schema\|credit]] | Crédito | 3 |
