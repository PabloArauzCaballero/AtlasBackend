import { QueryInterface, Transaction } from 'sequelize';

/**
 * Seeder demo de grafo profundo.
 *
 * Produce registros hijo/evento para probar endpoints de detalle, timeline y auditoría. No
 * inventa política de negocio (montos, cuotas, MDR, mora): solo produce datos de
 * demostración/prueba para relaciones ya definidas en el schema, reutilizando los IDs fijos
 * creados por los seeders anteriores:
 *   - tenants._id = 1, customers._id = 1 (customer_uuid = 11111111-1111-4111-8111-111111111111)
 *   - devices._id = 1, customer_sessions._id = 1, onboarding_flows._id = 1
 *   - risk_assessment_runs._id = 1, fraud_cases._id = 1, manual_review_cases._id = 1
 *   - watchlist_entries._id = 1, customer_contact_methods._id = 1, customer_identity_documents._id = 1
 *   - customer_consents._id = 1, internal_users._id = 1 (admin) y 2 (risk analyst)
 *   - attribute_definitions/observation_definitions (101-108), risk_policy_rules (101-106),
 *     risk_ruleset_versions/risk_model_versions (101), feature_values (101-103),
 *     context_catalogs/context_catalog_versions (101), context_items (1001)
 *
 * SUPUESTO_ATLAS: los valores numéricos (scores, distancias GPS, montos de confianza) son
 * ilustrativos para pruebas locales/QA, no calibraciones reales de modelo. No usar en ambientes
 * distintos de `local`/`staging` de desarrollo.
 *
 * TABLAS QUE QUEDAN PENDIENTES A PROPÓSITO (no se inventan aquí, ver docs/pending/pending-items.md):
 *   content_subscribers, external_oauth_connections, data_provider_requests, data_provider_responses,
 *   auth_refresh_tokens, idempotency_keys, system_action_logs, system_test_runs, system_test_step_runs,
 *   context_ingestion_jobs, context_staging_items, context_approval_events, schema_constraint_notes.
 * Motivo: son artefactos generados en runtime (tokens, ejecuciones de test, jobs de ingesta) o
 * requieren un payload de proveedor real/mock ya versionado; sembrarlos con datos ficticios sin
 * ese contrato definido arriesga dar una falsa sensación de cobertura. Quedan documentados como
 * pendiente técnico, no bloqueante para QA funcional del dominio cliente/riesgo/fraude.
 */

const CREATED_AT = new Date('2026-01-02T00:00:00.000Z');
const TENANT_ID = 1;
const CUSTOMER_ID = 1;
const DEVICE_ID = 1;
const SESSION_ID = 1;
const ONBOARDING_FLOW_ID = 1;
const RISK_RUN_ID = 1;
const FRAUD_CASE_ID = 1;
const MANUAL_REVIEW_CASE_ID = 1;
const WATCHLIST_ENTRY_ID = 1;
const CONTACT_METHOD_ID = 1;
const IDENTITY_DOCUMENT_ID = 1;
const CONSENT_ID = 1;
const ADMIN_INTERNAL_USER_ID = 1;
const RISK_ANALYST_INTERNAL_USER_ID = 2;

const jsonb = (value: unknown): string => JSON.stringify(value);

type SeedRow = Record<string, unknown>;
type SeedTable = { tableName: string; rows: SeedRow[]; identityColumn?: string };

const SEED_TABLES: SeedTable[] = [
  // --- Domicilio declarado + verificación GPS ---
  {
    tableName: 'customer_addresses',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        address_type: 'home',
        status: 'active',
        current_version_id: null,
        first_seen_at: CREATED_AT,
        last_seen_at: CREATED_AT,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'customer_address_versions',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_address_id: 1,
        declared_address_text: 'Av. Cristo Redentor #123, entre 3er y 4to anillo',
        normalized_address_text: 'AV CRISTO REDENTOR 123 3ER 4TO ANILLO',
        declared_zone_name: 'Centro',
        city: 'Santa Cruz de la Sierra',
        department: 'Santa Cruz',
        country_code: 'BOL',
        geo_zone_code_snapshot: 'scz_centro',
        geo_zone_name_snapshot: 'Centro',
        evidence_id: null,
        source_type: 'onboarding_form',
        verification_status: 'verified',
        verifiability_band: 'high',
        valid_from: CREATED_AT,
        valid_until: null,
        supersedes_version_id: null,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'address_gps_observations',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        customer_address_id: 1,
        address_version_id: 1,
        session_id: SESSION_ID,
        gps_lat: '-17.7833000',
        gps_lng: '-63.1821000',
        gps_accuracy_meters: '18.00',
        match_score_against_declared_address: '92.00',
        distance_to_declared_meters: '65.00',
        captured_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'customer_reference_contacts',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        relationship_type: 'family',
        full_name_hash: 'dev_seed_hash_ref_contact_full_name_0001',
        full_name_encrypted: null,
        phone_hash: 'dev_seed_hash_ref_contact_phone_0001',
        phone_encrypted: null,
        phone_last_4: '4321',
        consent_basis: 'explicit_consent',
        reference_notified: true,
        reference_notified_at: CREATED_AT,
        contactability_status: 'reachable',
        verification_status: 'unverified',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },

  // --- Verificaciones de contacto e identidad ---
  {
    tableName: 'contact_verification_attempts',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        contact_method_id: CONTACT_METHOD_ID,
        provider_request_id: null,
        verification_method: 'otp_email',
        verification_status: 'verified',
        confidence_score: '99.00',
        attempted_at: CREATED_AT,
        verified_at: CREATED_AT,
        failure_reason_code: null,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'evidence_documents',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        document_type: 'kyc_selfie',
        s3_bucket: 'atlas-dev-evidence-bucket',
        s3_key: `tenants/${TENANT_ID}/customers/${CUSTOMER_ID}/kyc/selfie-demo.jpg`,
        file_hash_sha256: 'dev_seed_hash_evidence_selfie_0001',
        mime_type: 'image/jpeg',
        file_size_bytes: 245678,
        status: 'stored',
        uploaded_at: CREATED_AT,
        uploaded_from_ip: '127.0.0.1',
        uploaded_from_session_id: SESSION_ID,
        uploaded_from_device_fingerprint: 'dev-device-fingerprint-001',
        retention_policy_id: 101,
        expires_at: null,
        retention_until: '2029-01-02',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'evidence_extractions',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        evidence_document_id: 1,
        extraction_method: 'liveness_and_face_match_mock',
        extraction_version: 'v1-dev',
        extracted_data_json: jsonb({ faceDetected: true, livenessPassed: true }),
        redacted_extracted_data_json: jsonb({ faceDetected: true }),
        confidence_score: '96.50',
        extracted_at: CREATED_AT,
        processing_duration_ms: 850,
        requires_review: false,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'evidence_reviews',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        evidence_document_id: 1,
        reviewed_by: ADMIN_INTERNAL_USER_ID,
        review_status: 'approved',
        reviewed_corrections_json: null,
        rejection_reason_code: null,
        reviewed_at: CREATED_AT,
        notes: 'Evidencia demo aprobada automáticamente para pruebas locales.',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'identity_verification_attempts',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        identity_document_id: IDENTITY_DOCUMENT_ID,
        provider_request_id: null,
        consent_id: CONSENT_ID,
        verification_channel: 'mobile_app',
        liveness_score: '97.00',
        selfie_match_score: '95.00',
        document_forensics_score: '93.00',
        name_match_score: '99.00',
        final_result: 'approved',
        reason_codes_json: jsonb(['KYC_DOCUMENT_MATCH']),
        selfie_evidence_id: 1,
        requested_at: CREATED_AT,
        completed_at: CREATED_AT,
        manual_reviewed_by: null,
        manual_review_notes: null,
        _created_at: CREATED_AT,
      },
    ],
  },

  // --- Atributos y observaciones del cliente (usan los catálogos ya sembrados 101-108) ---
  {
    tableName: 'customer_attribute_values',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        attribute_definition_id: 101, // age_years
        value_text: null,
        value_number: '30.0000',
        value_boolean: null,
        value_json: null,
        source_type: 'onboarding_form',
        evidence_id: null,
        confidence_score: '100.00',
        verification_status: 'declared',
        valid_from: CREATED_AT,
        valid_until: null,
        _created_at: CREATED_AT,
      },
      {
        _id: 2,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        attribute_definition_id: 102, // city_zone_code
        value_text: 'scz_centro',
        value_number: null,
        value_boolean: null,
        value_json: null,
        source_type: 'onboarding_form',
        evidence_id: null,
        confidence_score: '90.00',
        verification_status: 'declared',
        valid_from: CREATED_AT,
        valid_until: null,
        _created_at: CREATED_AT,
      },
      {
        _id: 3,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        attribute_definition_id: 104, // income_band_code
        value_text: 'income_2001_5000',
        value_number: null,
        value_boolean: null,
        value_json: null,
        source_type: 'onboarding_form',
        evidence_id: null,
        confidence_score: '80.00',
        verification_status: 'declared',
        valid_from: CREATED_AT,
        valid_until: null,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'customer_observations',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        session_id: SESSION_ID,
        device_id: DEVICE_ID,
        observation_code: 'device_fingerprint_hash',
        value_text: 'dev-device-fingerprint-001',
        value_number: null,
        value_boolean: null,
        value_json: null,
        source_type: 'device_sdk',
        source_provider_id: null,
        evidence_id: null,
        confidence_score: '99.00',
        verification_status: 'verified',
        captured_at: CREATED_AT,
        valid_from: CREATED_AT,
        valid_until: null,
        derivation_method: 'direct_capture',
        derivation_version: 'v1-dev',
        _created_at: CREATED_AT,
      },
      {
        _id: 2,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        session_id: SESSION_ID,
        device_id: DEVICE_ID,
        observation_code: 'gps_distance_from_declared_address_m',
        value_text: null,
        value_number: '65.0000',
        value_boolean: null,
        value_json: null,
        source_type: 'device_sdk',
        source_provider_id: null,
        evidence_id: null,
        confidence_score: '92.00',
        verification_status: 'verified',
        captured_at: CREATED_AT,
        valid_from: CREATED_AT,
        valid_until: null,
        derivation_method: 'gps_vs_declared_address',
        derivation_version: 'v1-dev',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'customer_context_enrichments',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        observation_id: null,
        catalog_id: 101, // city_zones_scz
        catalog_version_id: 101,
        matched_context_item_id: 1001, // scz_centro
        catalog_code_snapshot: 'city_zones_scz',
        catalog_version_code_snapshot: 'v1-seed',
        matched_item_code_snapshot: 'scz_centro',
        matched_item_name_snapshot: 'Centro',
        enrichment_code: 'declared_zone_matched',
        enrichment_value_json: jsonb({ riskSegment: 'urban_core' }),
        confidence_score: '95.00',
        match_method: 'exact_code_match',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'customer_action_logs',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        session_id: SESSION_ID,
        device_id: DEVICE_ID,
        event_name: 'onboarding_form_submitted',
        screen_name: 'onboarding_personal_data',
        action_payload_json: jsonb({ formVersion: 'v1-dev' }),
        occurred_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
      {
        _id: 2,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        session_id: SESSION_ID,
        device_id: DEVICE_ID,
        event_name: 'credit_line_offer_viewed',
        screen_name: 'credit_line_result',
        action_payload_json: jsonb({ offeredLimitBob: 1500 }),
        occurred_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },

  // --- Dispositivo: snapshot, riesgo, SIM, IP, push token ---
  {
    tableName: 'device_snapshots',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        device_id: DEVICE_ID,
        customer_id: CUSTOMER_ID,
        session_id: SESSION_ID,
        brand: 'Samsung',
        model: 'Galaxy A54',
        os_family: 'android',
        os_version: '14',
        app_version: '1.0.0-dev',
        device_release_year: 2023,
        device_age_months: 18,
        device_tier_snapshot: 'mid_range',
        estimated_device_value_bs_snapshot: '2200.00',
        is_rooted: false,
        is_emulator: false,
        vpn_detected: false,
        screen_count: 1,
        captured_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'device_risk_events',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        device_id: DEVICE_ID,
        event_type: 'initial_classification',
        previous_risk_status: null,
        new_risk_status: 'low_risk',
        reason_code: 'LOW_DEVICE_RISK',
        supporting_evidence_json: jsonb({ reuseCount: 1 }),
        happened_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'sim_observations',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        device_id: DEVICE_ID,
        customer_id: CUSTOMER_ID,
        session_id: SESSION_ID,
        phone_number_hash: 'dev_seed_hash_sim_phone_0001',
        phone_last_4: '0001',
        carrier_name: 'Tigo',
        sim_type: 'physical',
        sim_count: 1,
        phone_line_tenure_months: 36,
        last_sim_swap_at: null,
        sim_swap_days_since: null,
        source_type: 'device_sdk',
        confidence_score: '95.00',
        captured_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'ip_reputation_observations',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        session_id: SESSION_ID,
        customer_id: CUSTOMER_ID,
        device_id: DEVICE_ID,
        provider_request_id: null,
        ip_address: '127.0.0.1',
        is_vpn: false,
        is_proxy: false,
        is_tor: false,
        country_code: 'BOL',
        city: 'Santa Cruz de la Sierra',
        reputation_score: '95.00',
        captured_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'device_tokens',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        platform: 'expo_push',
        token_hash: 'dev_seed_hash_push_token_0001',
        token_encrypted: null,
        token_last4: 'demo',
        device_id: 'ExponentPushToken-dev-demo-0001',
        is_active: true,
        last_seen_at: CREATED_AT,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
    ],
  },

  // --- Onboarding: pasos, interacción de formulario, permisos, resumen de comportamiento ---
  {
    tableName: 'onboarding_step_events',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        onboarding_flow_id: ONBOARDING_FLOW_ID,
        step_code: 'phone_verification',
        event_type: 'completed',
        started_at: CREATED_AT,
        ended_at: CREATED_AT,
        duration_ms: 42000,
        error_count: 0,
        payload_json: jsonb({ channel: 'sms_otp' }),
        _created_at: CREATED_AT,
      },
      {
        _id: 2,
        _tenant_id: TENANT_ID,
        onboarding_flow_id: ONBOARDING_FLOW_ID,
        step_code: 'identity_document',
        event_type: 'completed',
        started_at: CREATED_AT,
        ended_at: CREATED_AT,
        duration_ms: 65000,
        error_count: 1,
        payload_json: jsonb({ documentType: 'ci' }),
        _created_at: CREATED_AT,
      },
      {
        _id: 3,
        _tenant_id: TENANT_ID,
        onboarding_flow_id: ONBOARDING_FLOW_ID,
        step_code: 'risk_scoring',
        event_type: 'completed',
        started_at: CREATED_AT,
        ended_at: CREATED_AT,
        duration_ms: 1200,
        error_count: 0,
        payload_json: jsonb({ riskAssessmentRunId: RISK_RUN_ID }),
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'form_field_interaction_events',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        onboarding_flow_id: ONBOARDING_FLOW_ID,
        field_code: 'full_name',
        interaction_type: 'typed',
        used_copy_paste: false,
        correction_count: 0,
        focus_duration_ms: 8000,
        occurred_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
      {
        _id: 2,
        _tenant_id: TENANT_ID,
        onboarding_flow_id: ONBOARDING_FLOW_ID,
        field_code: 'declared_income',
        interaction_type: 'typed',
        used_copy_paste: false,
        correction_count: 1,
        focus_duration_ms: 5000,
        occurred_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'permission_events',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        session_id: SESSION_ID,
        onboarding_flow_id: ONBOARDING_FLOW_ID,
        permission_code: 'camera_for_kyc',
        requested_at: CREATED_AT,
        granted: true,
        responded_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
      {
        _id: 2,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        session_id: SESSION_ID,
        onboarding_flow_id: ONBOARDING_FLOW_ID,
        permission_code: 'push_notifications',
        requested_at: CREATED_AT,
        granted: true,
        responded_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'onboarding_behavior_summaries',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        onboarding_flow_id: ONBOARDING_FLOW_ID,
        completion_time_seconds: 180,
        inter_screen_timing_json: jsonb({ phone_verification: 42, identity_document: 65, risk_scoring: 1 }),
        form_error_rate: '0.1000',
        ci_copy_paste_detected: false,
        abandonment_count_prior: 0,
        permission_grant_score: '100.00',
        behavior_cluster_code: 'consistent_human_pattern',
        bot_likelihood_score: '2.00',
        computation_version: 'seed-v1',
        computed_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'on_device_computation_runs',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        device_id: DEVICE_ID,
        session_id: SESSION_ID,
        onboarding_flow_id: ONBOARDING_FLOW_ID,
        consent_id: CONSENT_ID,
        algorithm_code: 'on_device_contacts_score_v1',
        algorithm_version: 'v1-dev',
        computation_status: 'completed',
        raw_contacts_stored: false,
        raw_sms_stored: false,
        integrity_hash: 'dev_seed_hash_on_device_run_0001',
        computed_at_device: CREATED_AT,
        received_at_server: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'on_device_metric_values',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        computation_run_id: 1,
        metric_code: 'on_device_contacts_score',
        value_text: null,
        value_number: '78.0000',
        value_boolean: null,
        value_json: null,
        confidence_score: '85.00',
        _created_at: CREATED_AT,
      },
    ],
  },

  // --- Detalle explicable del assessment de riesgo ya existente (risk_assessment_runs._id = 1) ---
  {
    tableName: 'risk_assessment_contexts',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        risk_assessment_run_id: RISK_RUN_ID,
        context_type: 'onboarding_credit_application',
        external_entity_type: null,
        external_entity_id: null,
        merchant_id_snapshot: null,
        merchant_code_snapshot: null,
        merchant_risk_band_snapshot: null,
        merchant_default_rate_snapshot: null,
        store_id_snapshot: null,
        product_category_snapshot: null,
        product_subcategory_snapshot: null,
        basket_item_count_snapshot: null,
        basket_duplicate_item_count_snapshot: null,
        basket_anomaly_score: null,
        transaction_amount_snapshot: null,
        currency_code: 'BOB',
        purchase_to_declared_income_ratio: null,
        down_payment_required_pct_snapshot: null,
        down_payment_behavior_snapshot: null,
        store_to_home_distance_meters: '65.00',
        context_payload_hash: 'dev_seed_hash_risk_context_0001',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'risk_rules_fired',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        risk_assessment_run_id: RISK_RUN_ID,
        risk_policy_rule_id: 105, // approve_good_contactability
        rule_code_snapshot: 'approve_good_contactability',
        ruleset_version_code_snapshot: 'v1-seed',
        risk_dimension: 'contactability',
        input_values_json: jsonb({ score_total: 82, feat_contactability_score: 78 }),
        output_action: 'APPROVE',
        reason_code: 'GOOD_CONTACTABILITY',
        severity: 'low',
        is_hard_stop: false,
        fired_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'risk_feature_contributions',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        risk_assessment_run_id: RISK_RUN_ID,
        feature_code: 'feat_contactability_score',
        raw_value_json: jsonb({ value: 82 }),
        bin_or_attribute: 'high',
        woe_value: '0.4500',
        score_points: '18.00',
        reason_code: 'GOOD_CONTACTABILITY',
        _created_at: CREATED_AT,
      },
      {
        _id: 2,
        _tenant_id: TENANT_ID,
        risk_assessment_run_id: RISK_RUN_ID,
        feature_code: 'feat_device_reuse_count',
        raw_value_json: jsonb({ value: 1 }),
        bin_or_attribute: 'low',
        woe_value: '0.1000',
        score_points: '5.00',
        reason_code: 'LOW_DEVICE_RISK',
        _created_at: CREATED_AT,
      },
      {
        _id: 3,
        _tenant_id: TENANT_ID,
        risk_assessment_run_id: RISK_RUN_ID,
        feature_code: 'feat_gps_consistency_score',
        raw_value_json: jsonb({ value: 92 }),
        bin_or_attribute: 'high',
        woe_value: '0.3000',
        score_points: '10.00',
        reason_code: null,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'feature_lineage_links',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        feature_value_id: 101, // feat_contactability_score, seed anterior
        source_type: 'observation',
        source_table: 'customer_observations',
        source_record_id: '2',
        source_code: 'gps_distance_from_declared_address_m',
        source_snapshot_json: jsonb({ distanceMeters: 65 }),
        contribution_weight: '0.6000',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'feature_snapshots',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        subject_type: 'customer',
        subject_id: CUSTOMER_ID,
        customer_id: CUSTOMER_ID,
        device_id: DEVICE_ID,
        snapshot_reason: 'onboarding_risk_assessment',
        triggering_entity_type: 'risk_assessment_run',
        triggering_entity_id: RISK_RUN_ID,
        risk_assessment_run_id: RISK_RUN_ID,
        session_id: SESSION_ID,
        onboarding_flow_id: ONBOARDING_FLOW_ID,
        feature_set_version: 'v1-seed',
        catalog_versions_json: jsonb({ city_zones_scz: 'v1-seed', income_bands_bob: 'v1-seed' }),
        features_json: jsonb({
          feat_contactability_score: 82,
          feat_device_reuse_count: 1,
          feat_gps_consistency_score: 92,
        }),
        missing_features_json: jsonb(['feat_bureau_dpd_max_12m']),
        integrity_hash: 'dev_seed_hash_feature_snapshot_0001',
        _created_at: CREATED_AT,
      },
    ],
  },

  // --- Timeline de fraude, revisión manual y watchlist ---
  {
    tableName: 'fraud_case_events',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        fraud_case_id: FRAUD_CASE_ID,
        event_type: 'case_opened',
        actor_type: 'system',
        actor_internal_user_id: null,
        happened_at: CREATED_AT,
        payload_json: jsonb({ pattern: 'dev_seed_pattern' }),
        notes: 'Caso abierto automáticamente por el seeder mínimo de desarrollo.',
        _created_at: CREATED_AT,
      },
      {
        _id: 2,
        _tenant_id: TENANT_ID,
        fraud_case_id: FRAUD_CASE_ID,
        event_type: 'assigned',
        actor_type: 'internal_user',
        actor_internal_user_id: RISK_ANALYST_INTERNAL_USER_ID,
        happened_at: CREATED_AT,
        payload_json: jsonb({ assignedTo: RISK_ANALYST_INTERNAL_USER_ID }),
        notes: 'Asignado a analista de riesgo demo para monitoreo.',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'manual_review_events',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        manual_review_case_id: MANUAL_REVIEW_CASE_ID,
        event_type: 'case_opened',
        actor_type: 'system',
        actor_internal_user_id: null,
        happened_at: CREATED_AT,
        payload_json: jsonb({ triggerSource: 'risk_assessment_run', riskAssessmentRunId: RISK_RUN_ID }),
        notes: 'Caso de revisión manual abierto por el seeder mínimo de desarrollo.',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'watchlist_matches',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        watchlist_entry_id: WATCHLIST_ENTRY_ID,
        customer_id: CUSTOMER_ID,
        session_id: SESSION_ID,
        device_id: DEVICE_ID,
        matched_entity_type: 'phone_hash',
        matched_value_hash: 'dev_seed_hash_000000000000000000000000000000000000000000000000000001',
        match_method: 'exact_hash_match',
        match_confidence: '100.00',
        opened_review_case_id: MANUAL_REVIEW_CASE_ID,
        opened_fraud_case_id: null,
        matched_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },

  // --- Privacidad: solicitud de titular de datos (para probar customer-privacy) ---
  {
    tableName: 'data_subject_requests',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        request_code: 'DSR-DEMO-001',
        customer_id: CUSTOMER_ID,
        request_type: 'access',
        status: 'resolved',
        requested_at: CREATED_AT,
        due_at: new Date('2026-02-01T00:00:00.000Z'),
        resolved_at: CREATED_AT,
        handled_by: ADMIN_INTERNAL_USER_ID,
        resolution_notes: 'Solicitud demo resuelta con exportación de datos de prueba.',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
];

async function insertSeedTable(queryInterface: QueryInterface, seedTable: SeedTable, transaction: Transaction): Promise<void> {
  await queryInterface.bulkInsert(seedTable.tableName, seedTable.rows, { transaction });
}

async function deleteSeedTable(queryInterface: QueryInterface, seedTable: SeedTable, transaction: Transaction): Promise<void> {
  const identityColumn = seedTable.identityColumn ?? '_id';
  const identityValues = seedTable.rows
    .map((row) => row[identityColumn])
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number');

  if (identityValues.length === 0) {
    return;
  }

  await queryInterface.bulkDelete(
    seedTable.tableName,
    {
      [identityColumn]: identityValues,
    },
    { transaction },
  );
}

async function resetSequence(queryInterface: QueryInterface, seedTable: SeedTable, transaction: Transaction): Promise<void> {
  const identityColumn = seedTable.identityColumn ?? '_id';

  if (identityColumn !== '_id') {
    return;
  }

  await queryInterface.sequelize.query(
    `
    SELECT setval(
      pg_get_serial_sequence('${seedTable.tableName}', '${identityColumn}'),
      COALESCE((SELECT MAX("${identityColumn}") FROM "${seedTable.tableName}"), 1),
      true
    )
    WHERE pg_get_serial_sequence('${seedTable.tableName}', '${identityColumn}') IS NOT NULL;
  `,
    { transaction },
  );
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const seedTable of SEED_TABLES) {
      await insertSeedTable(queryInterface, seedTable, transaction);
      await resetSequence(queryInterface, seedTable, transaction);
    }

    await queryInterface.bulkUpdate('customer_addresses', { current_version_id: 1, _updated_at: CREATED_AT }, { _id: 1 }, { transaction });
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.bulkUpdate('customer_addresses', { current_version_id: null }, { _id: 1 }, { transaction });

    for (const seedTable of [...SEED_TABLES].reverse()) {
      await deleteSeedTable(queryInterface, seedTable, transaction);
      await resetSequence(queryInterface, seedTable, transaction);
    }
  });
}
