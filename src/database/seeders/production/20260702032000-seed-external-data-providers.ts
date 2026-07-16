import { QueryInterface } from 'sequelize';

type SeedContext = { context: QueryInterface };

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

type ProviderSeed = {
  provider_code: string;
  provider_name: string;
  provider_type: string;
  provider_category: string;
  provider_status: string;
  default_mode: string;
  requires_consent: boolean;
  requires_manual_approval: boolean;
  is_costly: boolean;
  description: string;
};

const PROVIDERS: ProviderSeed[] = [
  {
    provider_code: 'SEGIP',
    provider_name: 'SEGIP / CGIP Identity Verification',
    provider_type: 'identity',
    provider_category: 'IDENTITY',
    provider_status: 'ACTIVE',
    default_mode: 'mock_local',
    requires_consent: true,
    requires_manual_approval: false,
    is_costly: false,
    description: 'Provider base para validación de identidad. CGIP queda como alias operativo, proveedor oficial SEGIP.',
  },
  {
    provider_code: 'INFOCENTER',
    provider_name: 'InfoCenter Credit Bureau',
    provider_type: 'credit_bureau',
    provider_category: 'CREDIT_BUREAU',
    provider_status: 'ACTIVE',
    default_mode: 'mock_local',
    requires_consent: true,
    requires_manual_approval: true,
    is_costly: true,
    description: 'Provider caro. Bloqueado por política salvo revisión manual, incremento de línea o fraude.',
  },
  {
    provider_code: 'QR_GENERIC',
    provider_name: 'QR Generic Payment Provider',
    provider_type: 'payments',
    provider_category: 'PAYMENTS',
    provider_status: 'MOCK_ONLY',
    default_mode: 'mock_local',
    requires_consent: false,
    requires_manual_approval: false,
    is_costly: false,
    description: 'Provider contractual para fase 2 QR. No es integración real bancaria.',
  },
  {
    provider_code: 'BANKING_GENERIC',
    provider_name: 'Banking Generic Provider',
    provider_type: 'banking',
    provider_category: 'BANKING',
    provider_status: 'MOCK_ONLY',
    default_mode: 'mock_local',
    requires_consent: true,
    requires_manual_approval: false,
    is_costly: false,
    description: 'Provider contractual para fase 2 banca general. Los bancos concretos serán mini providers posteriores.',
  },
  {
    provider_code: 'TELCO_GENERIC',
    provider_name: 'Telco Generic Trust Provider',
    provider_type: 'telco',
    provider_category: 'TELCO',
    provider_status: 'MOCK_ONLY',
    default_mode: 'mock_local',
    requires_consent: true,
    requires_manual_approval: false,
    is_costly: false,
    description: 'Provider contractual para fase 3 telefonía: antigüedad, actividad y SIM swap si existe API/contrato.',
  },
  {
    provider_code: 'FACEBOOK_META',
    provider_name: 'Facebook / Meta OAuth Trust Provider',
    provider_type: 'social',
    provider_category: 'SOCIAL',
    provider_status: 'MOCK_ONLY',
    default_mode: 'mock_local',
    requires_consent: true,
    requires_manual_approval: false,
    is_costly: false,
    description: 'Provider voluntario por OAuth/API oficial. No scraping, no contraseñas, no antigüedad inventada.',
  },
  {
    provider_code: 'WHATSAPP_GENERIC',
    provider_name: 'WhatsApp Generic Contactability Provider',
    provider_type: 'messaging',
    provider_category: 'MESSAGING',
    provider_status: 'MOCK_ONLY',
    default_mode: 'mock_local',
    requires_consent: true,
    requires_manual_approval: false,
    is_costly: false,
    description: 'Provider contractual para OTP/contactabilidad. No leer chats ni guardar contactos.',
  },
  {
    provider_code: 'DIGITAL_TRUST_GENERIC',
    provider_name: 'Digital Trust Generic Provider',
    provider_type: 'digital_trust',
    provider_category: 'DIGITAL_TRUST',
    provider_status: 'MOCK_ONLY',
    default_mode: 'mock_local',
    requires_consent: true,
    requires_manual_approval: false,
    is_costly: false,
    description: 'Provider contractual para reputación digital, identidad sintética, email/IP/device risk.',
  },
];

async function upsertProvider(queryInterface: QueryInterface, provider: ProviderSeed): Promise<void> {
  await queryInterface.sequelize.query(
    `
    INSERT INTO data_providers (
      provider_code, provider_name, provider_type, provider_category, provider_status, default_mode,
      requires_consent, requires_manual_approval, is_costly, reliability_score, supports_retro_data,
      default_retention_policy_id, is_active, description, _created_at, _updated_at
    )
    VALUES (
      :provider_code, :provider_name, :provider_type, :provider_category, :provider_status, :default_mode,
      :requires_consent, :requires_manual_approval, :is_costly, 90.00, false, 1, true, :description, :created_at, :created_at
    )
    ON CONFLICT (provider_code) WHERE provider_code IS NOT NULL DO UPDATE SET
      provider_name = EXCLUDED.provider_name,
      provider_type = EXCLUDED.provider_type,
      provider_category = EXCLUDED.provider_category,
      provider_status = EXCLUDED.provider_status,
      default_mode = EXCLUDED.default_mode,
      requires_consent = EXCLUDED.requires_consent,
      requires_manual_approval = EXCLUDED.requires_manual_approval,
      is_costly = EXCLUDED.is_costly,
      description = EXCLUDED.description,
      is_active = true,
      _updated_at = EXCLUDED._updated_at;
    `,
    { replacements: { ...provider, created_at: CREATED_AT } },
  );
}

async function upsertPolicy(
  queryInterface: QueryInterface,
  providerCode: string,
  queryType: string,
  costTier: string,
  blockByDefault: boolean,
  requiresManualApproval: boolean,
  allowedStages: string[],
  unitCostAmount = '0.0000',
  cacheTtlSeconds = 0,
  featureTtlSeconds = 604800,
  retryMaxAttempts = 1,
  retryBackoffSeconds = 30,
): Promise<void> {
  await queryInterface.sequelize.query(
    `
    INSERT INTO external_provider_cost_policies (
      provider_id, query_type, unit_cost_amount, currency, cost_tier, max_queries_per_user_per_day,
      max_queries_per_user_per_month, max_queries_global_per_day, allowed_decision_stages_json,
      requires_manual_approval, requires_admin_role, block_by_default, cache_ttl_seconds, feature_ttl_seconds,
      retry_max_attempts, retry_backoff_seconds, active, active_from, active_to, _created_at, _updated_at
    )
    SELECT dp._id, :queryType, :unitCostAmount, 'BOB', :costTier, 1, 2, 100,
      CAST(:allowedStages AS jsonb), :requiresManualApproval, :requiresManualApproval,
      :blockByDefault, :cacheTtlSeconds, :featureTtlSeconds, :retryMaxAttempts, :retryBackoffSeconds,
      true, :created_at, NULL, :created_at, :created_at
    FROM data_providers dp
    WHERE dp.provider_code = :providerCode
    ON CONFLICT (provider_id, query_type) DO UPDATE SET
      unit_cost_amount = EXCLUDED.unit_cost_amount,
      currency = EXCLUDED.currency,
      cost_tier = EXCLUDED.cost_tier,
      allowed_decision_stages_json = EXCLUDED.allowed_decision_stages_json,
      requires_manual_approval = EXCLUDED.requires_manual_approval,
      requires_admin_role = EXCLUDED.requires_admin_role,
      block_by_default = EXCLUDED.block_by_default,
      cache_ttl_seconds = EXCLUDED.cache_ttl_seconds,
      feature_ttl_seconds = EXCLUDED.feature_ttl_seconds,
      retry_max_attempts = EXCLUDED.retry_max_attempts,
      retry_backoff_seconds = EXCLUDED.retry_backoff_seconds,
      active = true,
      _updated_at = EXCLUDED._updated_at;
    `,
    {
      replacements: {
        providerCode,
        queryType,
        costTier,
        blockByDefault,
        requiresManualApproval,
        allowedStages: JSON.stringify(allowedStages),
        unitCostAmount,
        cacheTtlSeconds,
        featureTtlSeconds,
        retryMaxAttempts,
        retryBackoffSeconds,
        created_at: CREATED_AT,
      },
    },
  );
}

export async function up({ context: queryInterface }: SeedContext): Promise<void> {
  for (const provider of PROVIDERS) await upsertProvider(queryInterface, provider);

  await upsertPolicy(
    queryInterface,
    'SEGIP',
    'IDENTITY_VERIFICATION',
    'LOW',
    false,
    false,
    ['ONBOARDING', 'CREDIT_APPLICATION', 'MANUAL_REVIEW'],
    '0.0000',
    86400,
    604800,
    1,
    30,
  );
  await upsertPolicy(
    queryInterface,
    'INFOCENTER',
    'CREDIT_REPORT',
    'HIGH',
    true,
    true,
    ['MANUAL_REVIEW', 'LIMIT_INCREASE', 'FRAUD_REVIEW'],
    '0.0000',
    2592000,
    2592000,
    0,
    0,
  );
  await upsertPolicy(
    queryInterface,
    'INFOCENTER',
    'CREDIT_SCORE',
    'HIGH',
    true,
    true,
    ['MANUAL_REVIEW', 'LIMIT_INCREASE', 'FRAUD_REVIEW'],
    '0.0000',
    2592000,
    2592000,
    0,
    0,
  );
  await upsertPolicy(
    queryInterface,
    'QR_GENERIC',
    'PAYMENT_VERIFICATION',
    'LOW',
    false,
    false,
    ['PAYMENT_RECONCILIATION', 'CREDIT_APPLICATION'],
    '0.0000',
    0,
    86400,
    1,
    15,
  );
  await upsertPolicy(
    queryInterface,
    'BANKING_GENERIC',
    'BANK_TRANSFER_VERIFICATION',
    'LOW',
    false,
    false,
    ['PAYMENT_RECONCILIATION'],
    '0.0000',
    0,
    86400,
    1,
    15,
  );
  await upsertPolicy(
    queryInterface,
    'TELCO_GENERIC',
    'PHONE_TRUST_CHECK',
    'MEDIUM',
    false,
    false,
    ['ONBOARDING', 'FRAUD_REVIEW', 'MANUAL_REVIEW'],
    '0.0000',
    604800,
    604800,
    1,
    30,
  );
  await upsertPolicy(
    queryInterface,
    'FACEBOOK_META',
    'SOCIAL_TRUST_CHECK',
    'FREE',
    false,
    false,
    ['ONBOARDING', 'MANUAL_REVIEW'],
    '0.0000',
    604800,
    604800,
    0,
    0,
  );
  await upsertPolicy(
    queryInterface,
    'WHATSAPP_GENERIC',
    'WHATSAPP_OTP_VERIFICATION',
    'LOW',
    false,
    false,
    ['ONBOARDING', 'CONTACTABILITY'],
    '0.0000',
    0,
    86400,
    0,
    0,
  );
  await upsertPolicy(
    queryInterface,
    'DIGITAL_TRUST_GENERIC',
    'DIGITAL_TRUST_CHECK',
    'HIGH',
    true,
    true,
    ['MANUAL_REVIEW', 'FRAUD_REVIEW'],
    '0.0000',
    604800,
    604800,
    0,
    0,
  );
}

export async function down({ context: queryInterface }: SeedContext): Promise<void> {
  await queryInterface.bulkDelete('external_provider_cost_policies', {}, {});
  await queryInterface.bulkDelete('data_providers', { provider_code: PROVIDERS.map((provider) => provider.provider_code) }, {});
}
