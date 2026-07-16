import { QueryInterface, Transaction } from 'sequelize';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const SAMPLE_HASH = 'dev_seed_hash_000000000000000000000000000000000000000000000000000001';
const CUSTOMER_UUID = '11111111-1111-4111-8111-111111111111';
const jsonb = (value: unknown): string => JSON.stringify(value);

type SeedRow = Record<string, unknown>;

type SeedTable = {
  tableName: string;
  rows: SeedRow[];
  identityColumn?: string;
};

const SEED_TABLES: SeedTable[] = [
  {
    tableName: 'tenants',
    rows: [
      {
        _id: 1,
        tenant_code: 'atlas-bo-dev',
        legal_name: 'Atlas Bolivia Dev Tenant',
        country_code: 'BOL',
        status: 'active',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'platform_users',
    rows: [
      {
        _id: 1,
        user_code: 'pablo.platform',
        full_name: 'Pablo Platform Admin',
        email: 'pablo.platform@atlas.test',
        role_code: 'platform_super_admin',
        status: 'active',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'internal_users',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        user_code: 'pablo.admin',
        full_name: 'Pablo Tenant Admin',
        email: 'pablo.admin@atlas.test',
        role_code: 'tenant_admin',
        status: 'active',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
      {
        _id: 2,
        _tenant_id: 1,
        user_code: 'risk.ops',
        full_name: 'Risk Operations Demo',
        email: 'risk.ops@atlas.test',
        role_code: 'risk_analyst',
        status: 'active',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'retention_policies',
    rows: [
      {
        _id: 1,
        policy_code: 'risk-data-365d',
        applies_to: 'risk_and_fraud_testing',
        retention_days: 365,
        post_retention_action: 'anonymize',
        legal_basis: 'dev_testing_only',
        description: 'Política mínima para datos de prueba de riesgo y fraude.',
        is_active: true,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'privacy_processing_purposes',
    rows: [
      {
        _id: 1,
        purpose_code: 'risk_fraud_assessment',
        purpose_name: 'Evaluación de riesgo y fraude',
        legal_basis: 'explicit_consent',
        description: 'Permite probar consentimientos mínimos para señales de usuario, dispositivo y comportamiento.',
        requires_explicit_consent: true,
        is_active: true,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'consent_documents',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        document_code: 'privacy-policy-dev',
        version_code: 'v1-dev',
        language: 'es',
        effective_from: '2026-01-01',
        effective_until: null,
        content_url: 'https://atlas.test/legal/privacy-policy-dev',
        content_hash: SAMPLE_HASH,
        requires_explicit_action: true,
        published_by_internal_user_id: 1,
        published_at: CREATED_AT,
        status: 'published',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'global_device_fingerprints',
    rows: [
      {
        _id: 1,
        device_fingerprint: 'dev-device-fingerprint-001',
        fingerprint_version: 'v1',
        global_first_seen_at: CREATED_AT,
        global_last_seen_at: CREATED_AT,
        global_reuse_count: 1,
        global_risk_status: 'low_risk',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'customers',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_code: 'CUS-DEMO-001',
        customer_uuid: CUSTOMER_UUID,
        primary_phone_hash: SAMPLE_HASH,
        primary_phone_encrypted: null,
        primary_phone_last_4: '0001',
        primary_email_hash: `${SAMPLE_HASH}-email`,
        primary_email_encrypted: null,
        primary_email_domain: 'atlas.test',
        lifecycle_status: 'active',
        current_profile_version_id: null,
        closed_at: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'customer_profile_versions',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_id: 1,
        first_name: 'Cliente',
        last_name: 'Demo',
        full_name_normalized: 'CLIENTE DEMO',
        birth_date: '1996-01-01',
        age_at_capture: 30,
        gender_declared: null,
        preferred_language: 'es',
        marketing_opt_in: false,
        source_type: 'seed',
        valid_from: CREATED_AT,
        valid_until: null,
        supersedes_version_id: null,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'customer_status_events',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_id: 1,
        previous_status: null,
        new_status: 'active',
        reason_code: 'seed_created',
        changed_by_type: 'internal_user',
        changed_by_internal_user_id: 1,
        changed_by_platform_user_id: null,
        happened_at: CREATED_AT,
        notes: 'Cliente demo creado por seeder mínimo.',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'customer_contact_methods',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_id: 1,
        contact_type: 'email',
        contact_value_hash: `${SAMPLE_HASH}-contact`,
        contact_value_encrypted: null,
        normalized_value_hash: `${SAMPLE_HASH}-normalized`,
        value_last_4: 'test',
        email_domain: 'atlas.test',
        label: 'primary',
        is_primary: true,
        status: 'verified',
        source_type: 'seed',
        first_seen_at: CREATED_AT,
        last_seen_at: CREATED_AT,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'customer_identity_documents',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_id: 1,
        document_type: 'ci',
        declared_number_hash: `${SAMPLE_HASH}-ci`,
        declared_number_encrypted: null,
        declared_number_last_4: '0001',
        declared_complement: null,
        declared_issued_in: 'SCZ',
        ocr_number_hash: `${SAMPLE_HASH}-ocr`,
        ocr_full_name: 'CLIENTE DEMO',
        ocr_birth_date: '1996-01-01',
        ocr_confidence_score: '98.50',
        verified_number_hash: `${SAMPLE_HASH}-verified`,
        issued_at: '2020-01-01',
        expires_at: null,
        front_evidence_id: null,
        back_evidence_id: null,
        verification_status: 'verified',
        verified_at: CREATED_AT,
        valid_from: CREATED_AT,
        valid_until: null,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'devices',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        global_device_fingerprint_id: 1,
        device_fingerprint: 'dev-device-fingerprint-001',
        fingerprint_version: 'v1',
        first_seen_at: CREATED_AT,
        last_seen_at: CREATED_AT,
        tenant_reuse_count: 1,
        risk_status: 'low_risk',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'customer_device_links',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_id: 1,
        device_id: 1,
        link_status: 'active',
        is_primary_device: true,
        trust_level: 'trusted',
        first_seen_session_id: null,
        last_seen_session_id: null,
        first_seen_at: CREATED_AT,
        last_seen_at: CREATED_AT,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'customer_sessions',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_id: 1,
        device_id: 1,
        session_token_hash: `${SAMPLE_HASH}-session`,
        channel: 'mobile_app',
        auth_method: 'dev_seed_placeholder',
        started_at: CREATED_AT,
        ended_at: null,
        ip_address: '127.0.0.1',
        user_agent: 'Atlas Dev Seed Agent',
        gps_lat: '-17.7833000',
        gps_lng: '-63.1821000',
        gps_accuracy_meters: '25.00',
        session_status: 'active',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'auth_events',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_id: 1,
        session_id: 1,
        device_id: 1,
        event_type: 'login_placeholder',
        login_successful: true,
        failure_reason_code: null,
        occurred_at: CREATED_AT,
        ip_address: '127.0.0.1',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'customer_consents',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_id: 1,
        consent_document_id: 1,
        purpose_code: 'risk_fraud_assessment',
        granted: true,
        granted_at: CREATED_AT,
        revoked_at: null,
        channel: 'mobile_app',
        session_id: 1,
        ip_address: '127.0.0.1',
        device_fingerprint_snapshot: 'dev-device-fingerprint-001',
        user_agent: 'Atlas Dev Seed Agent',
        evidence_snapshot_url: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'consent_events',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_consent_id: 1,
        event_type: 'granted',
        happened_at: CREATED_AT,
        channel: 'mobile_app',
        session_id: 1,
        ip_address: '127.0.0.1',
        device_fingerprint_snapshot: 'dev-device-fingerprint-001',
        triggered_by_type: 'customer',
        triggered_by_internal_user_id: null,
        notes: 'Consentimiento demo para pruebas locales.',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'onboarding_flows',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        customer_id: 1,
        session_id: 1,
        flow_version: 'v1-dev',
        started_at: CREATED_AT,
        completed_at: CREATED_AT,
        abandoned_at: null,
        completion_status: 'completed',
        total_duration_seconds: 180,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'risk_assessment_runs',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        subject_type: 'customer',
        subject_id: 1,
        customer_id: 1,
        session_id: 1,
        onboarding_flow_id: 1,
        device_id: 1,
        feature_snapshot_id: null,
        risk_model_version_id: null,
        risk_ruleset_version_id: null,
        assessment_type: 'onboarding_fraud_demo',
        trigger_source: 'seed',
        idempotency_key: 'seed-risk-run-001',
        run_status: 'completed',
        started_at: CREATED_AT,
        completed_at: CREATED_AT,
        latency_ms: 12,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'risk_assessment_results',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        risk_assessment_run_id: 1,
        subject_type: 'customer',
        subject_id: 1,
        customer_id: 1,
        session_id: 1,
        onboarding_flow_id: 1,
        device_id: 1,
        assessment_type: 'onboarding_fraud_demo',
        recommended_action: 'approve_for_testing',
        risk_level: 'low',
        score_total: '82.00',
        fraud_score: '8.00',
        identity_score: '90.00',
        device_risk_score: '85.00',
        behavior_score: '80.00',
        contactability_score: '75.00',
        consistency_score: '88.00',
        reason_codes_json: jsonb(['DEV_SEED_LOW_RISK']),
        model_version_code_snapshot: 'manual-dev-v1',
        ruleset_version_code_snapshot: 'ruleset-dev-v1',
        feature_snapshot_id: null,
        integrity_hash: `${SAMPLE_HASH}-risk-result`,
        decided_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'customer_activity_summaries',
    identityColumn: 'customer_id',
    rows: [
      {
        customer_id: 1,
        _tenant_id: 1,
        first_session_at: CREATED_AT,
        last_session_at: CREATED_AT,
        first_device_id: 1,
        usual_device_id: 1,
        total_sessions: 1,
        total_devices_seen: 1,
        failed_login_count_7d: 0,
        device_change_count_30d: 0,
        suspicious_ip_count_30d: 0,
        current_risk_level: 'low',
        current_trust_tier: 'trusted',
        last_risk_assessment_id: 1,
        last_risk_assessed_at: CREATED_AT,
        watchlist_hit_count_lifetime: 0,
        fraud_case_count_lifetime: 0,
        open_manual_review_count: 0,
        recomputed_at: CREATED_AT,
        computation_version: 'seed-v1',
      },
    ],
  },
  {
    tableName: 'manual_review_cases',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        case_code: 'MR-DEMO-001',
        customer_id: 1,
        risk_assessment_run_id: 1,
        fraud_case_id: null,
        case_type: 'risk_review_demo',
        priority: 'low',
        status: 'open',
        assigned_to_internal_user_id: 2,
        opened_at: CREATED_AT,
        closed_at: null,
        resolution: null,
        notes: 'Caso mínimo para probar revisión manual.',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'fraud_cases',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        case_code: 'FR-DEMO-001',
        customer_id: 1,
        primary_device_id: 1,
        escalated_from_review_case_id: null,
        case_status: 'monitoring',
        severity: 'low',
        pattern_detected: 'dev_seed_pattern',
        linked_customers_json: jsonb([1]),
        linked_sessions_json: jsonb([1]),
        linked_devices_json: jsonb([1]),
        assigned_to_internal_user_id: 2,
        opened_at: CREATED_AT,
        closed_at: null,
        resolution: null,
        notes: 'Caso mínimo para probar estructura de fraude sin afectar lógica de crédito.',
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'watchlist_entries',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        scope: 'tenant',
        country_code: null,
        entity_type: 'phone_hash',
        entity_hash: SAMPLE_HASH,
        entity_last_4: '0001',
        reason_code: 'dev_seed_watchlist_entry',
        severity: 'low',
        status: 'active',
        source_type: 'manual_seed',
        created_by_type: 'internal_user',
        created_by_internal_user_id: 2,
        created_by_platform_user_id: null,
        expires_at: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
        _deleted: false,
      },
    ],
  },
  {
    tableName: 'data_change_logs',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        table_name: 'customers',
        record_id: '1',
        change_type: 'seed_insert',
        changed_by_type: 'internal_user',
        changed_by_internal_user_id: 1,
        changed_by_platform_user_id: null,
        old_values_hash: null,
        new_values_hash: `${SAMPLE_HASH}-change`,
        change_reason: 'Seeder mínimo de desarrollo.',
        changed_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'operational_audit_logs',
    rows: [
      {
        _id: 1,
        _tenant_id: 1,
        actor_type: 'internal_user',
        actor_internal_user_id: 1,
        actor_platform_user_id: null,
        action_code: 'seed.minimal_dev_credentials.applied',
        target_type: 'database_seed',
        target_id: '20260626160720-seed-minimal-dev-credentials',
        ip_address: '127.0.0.1',
        user_agent: 'Atlas Seeder',
        payload_json: jsonb({
          note: 'Seeder mínimo para pruebas locales de estructura ORM/migraciones.',
        }),
        occurred_at: CREATED_AT,
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'data_quality_rules',
    rows: [
      {
        _id: 1,
        rule_code: 'DQ_CUSTOMER_EMAIL_HASH_PRESENT_DEV',
        rule_name: 'Customer email hash present for dev fixture',
        target_table: 'customers',
        target_field: 'primary_email_hash',
        severity: 'low',
        expression_json: jsonb({
          required_when: 'customer fixture is used for dev testing',
        }),
        expected_action: 'review',
        build_phase: 'mvp_seed',
        is_active: true,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
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
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const seedTable of [...SEED_TABLES].reverse()) {
      await deleteSeedTable(queryInterface, seedTable, transaction);
      await resetSequence(queryInterface, seedTable, transaction);
    }
  });
}
