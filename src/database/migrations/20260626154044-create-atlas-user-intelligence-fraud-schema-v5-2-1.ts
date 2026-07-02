import { DataTypes, Model, ModelAttributeColumnOptions, ModelAttributes, QueryInterface } from 'sequelize';

type ColumnKind =
  'BIGINT' | 'STRING' | 'TEXT' | 'BOOLEAN' | 'INTEGER' | 'DECIMAL' | 'DATE' | 'DATEONLY' | 'UUID' | 'JSONB' | 'BLOB' | 'INET';

type ColumnSpec = {
  kind: ColumnKind;
  length?: number;
  precision?: number;
  scale?: number;
  allowNull: boolean;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  comment?: string;
};

type TableSpec = {
  className: string;
  tableName: string;
  stereotypes: string[];
  columns: Array<{ name: string; spec: ColumnSpec }>;
};

type ForeignKeySpec = {
  table: string;
  column: string;
  targetTable: string;
  targetColumn: string;
  allowNull: boolean;
};

type IndexSpec = {
  table: string;
  fields?: string[];
  rawColumns?: string | null;
  where?: string | null;
  unique?: boolean;
  using?: 'gin' | null;
};

const TABLES: TableSpec[] = [
  {
    className: 'Tenant',
    tableName: 'tenants',
    stereotypes: ['platform-root'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'tenant_code',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'legal_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'country_code',
        spec: {
          kind: 'STRING',
          length: 3,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'PlatformUser',
    tableName: 'platform_users',
    stereotypes: ['platform-root'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'user_code',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'full_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'email',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'role_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'InternalUser',
    tableName: 'internal_users',
    stereotypes: ['core'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'user_code',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'full_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'email',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'role_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'RetentionPolicy',
    tableName: 'retention_policies',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'policy_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'applies_to',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'retention_days',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'post_retention_action',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'legal_basis',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'description',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'DataProvider',
    tableName: 'data_providers',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'provider_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'provider_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'provider_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'reliability_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'supports_retro_data',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'default_retention_policy_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'DataProviderRequest',
    tableName: 'data_provider_requests',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'provider_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'consent_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'request_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'provider_request_ref',
        spec: {
          kind: 'STRING',
          length: 160,
          allowNull: true,
        },
      },
      {
        name: 'request_payload_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'idempotency_key',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'response_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'response_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'latency_ms',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'requested_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'responded_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'DataProviderResponse',
    tableName: 'data_provider_responses',
    stereotypes: ['append-only', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'provider_request_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'payload_storage_strategy',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'response_payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'redacted_payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'raw_payload_s3_key',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'response_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'normalized_payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'contains_sensitive_data',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'retention_policy_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'retention_until',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'Customer',
    tableName: 'customers',
    stereotypes: ['core', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_code',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'customer_uuid',
        spec: {
          kind: 'UUID',
          allowNull: true,
        },
      },
      {
        name: 'primary_phone_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'primary_phone_encrypted',
        spec: {
          kind: 'BLOB',
          allowNull: true,
        },
      },
      {
        name: 'primary_phone_last_4',
        spec: {
          kind: 'STRING',
          length: 4,
          allowNull: true,
        },
      },
      {
        name: 'primary_email_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'primary_email_encrypted',
        spec: {
          kind: 'BLOB',
          allowNull: true,
        },
      },
      {
        name: 'primary_email_domain',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'lifecycle_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'current_profile_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'closed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'CustomerStatusEvent',
    tableName: 'customer_status_events',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'previous_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'new_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'reason_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'changed_by_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'changed_by_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'changed_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'happened_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'CustomerProfileVersion',
    tableName: 'customer_profile_versions',
    stereotypes: ['versioned', 'append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'first_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'last_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'full_name_normalized',
        spec: {
          kind: 'STRING',
          length: 260,
          allowNull: true,
        },
      },
      {
        name: 'birth_date',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: 'age_at_capture',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'gender_declared',
        spec: {
          kind: 'STRING',
          length: 30,
          allowNull: true,
        },
      },
      {
        name: 'preferred_language',
        spec: {
          kind: 'STRING',
          length: 10,
          allowNull: true,
        },
      },
      {
        name: 'marketing_opt_in',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'valid_from',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'valid_until',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'supersedes_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'CustomerIdentityDocument',
    tableName: 'customer_identity_documents',
    stereotypes: ['versioned', 'append-only', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'document_type',
        spec: {
          kind: 'STRING',
          length: 30,
          allowNull: true,
        },
      },
      {
        name: 'declared_number_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'declared_number_encrypted',
        spec: {
          kind: 'BLOB',
          allowNull: true,
        },
      },
      {
        name: 'declared_number_last_4',
        spec: {
          kind: 'STRING',
          length: 4,
          allowNull: true,
        },
      },
      {
        name: 'declared_complement',
        spec: {
          kind: 'STRING',
          length: 10,
          allowNull: true,
        },
      },
      {
        name: 'declared_issued_in',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'ocr_number_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'ocr_full_name',
        spec: {
          kind: 'STRING',
          length: 260,
          allowNull: true,
        },
      },
      {
        name: 'ocr_birth_date',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: 'ocr_confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'verified_number_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'issued_at',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: 'expires_at',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: 'front_evidence_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'back_evidence_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'verification_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'verified_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'valid_from',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'valid_until',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'IdentityVerificationAttempt',
    tableName: 'identity_verification_attempts',
    stereotypes: ['append-only', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'identity_document_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'provider_request_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'consent_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'verification_channel',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'liveness_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'selfie_match_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'document_forensics_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'name_match_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'final_result',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'reason_codes_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'selfie_evidence_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'requested_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'completed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'manual_reviewed_by',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'manual_review_notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'CustomerContactMethod',
    tableName: 'customer_contact_methods',
    stereotypes: ['core', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'contact_type',
        spec: {
          kind: 'STRING',
          length: 30,
          allowNull: true,
        },
      },
      {
        name: 'contact_value_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'contact_value_encrypted',
        spec: {
          kind: 'BLOB',
          allowNull: true,
        },
      },
      {
        name: 'normalized_value_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'value_last_4',
        spec: {
          kind: 'STRING',
          length: 4,
          allowNull: true,
        },
      },
      {
        name: 'email_domain',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'label',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'is_primary',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'first_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'last_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'ContactVerificationAttempt',
    tableName: 'contact_verification_attempts',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'contact_method_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'provider_request_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'verification_method',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'verification_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'attempted_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'verified_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'failure_reason_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'CustomerAddress',
    tableName: 'customer_addresses',
    stereotypes: ['core'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'address_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'current_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'first_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'last_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'CustomerAddressVersion',
    tableName: 'customer_address_versions',
    stereotypes: ['versioned', 'append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_address_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'declared_address_text',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'normalized_address_text',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'declared_zone_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'city',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'department',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'country_code',
        spec: {
          kind: 'STRING',
          length: 3,
          allowNull: true,
        },
      },
      {
        name: 'geo_zone_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'geo_zone_name_snapshot',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'evidence_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'verification_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'verifiability_band',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'valid_from',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'valid_until',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'supersedes_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'AddressGpsObservation',
    tableName: 'address_gps_observations',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_address_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'address_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'gps_lat',
        spec: {
          kind: 'DECIMAL',
          precision: 10,
          scale: 7,
          allowNull: true,
        },
      },
      {
        name: 'gps_lng',
        spec: {
          kind: 'DECIMAL',
          precision: 10,
          scale: 7,
          allowNull: true,
        },
      },
      {
        name: 'gps_accuracy_meters',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'match_score_against_declared_address',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'distance_to_declared_meters',
        spec: {
          kind: 'DECIMAL',
          precision: 12,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'captured_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'CustomerReferenceContact',
    tableName: 'customer_reference_contacts',
    stereotypes: ['core', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'relationship_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'full_name_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'full_name_encrypted',
        spec: {
          kind: 'BLOB',
          allowNull: true,
        },
      },
      {
        name: 'phone_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'phone_encrypted',
        spec: {
          kind: 'BLOB',
          allowNull: true,
        },
      },
      {
        name: 'phone_last_4',
        spec: {
          kind: 'STRING',
          length: 4,
          allowNull: true,
        },
      },
      {
        name: 'consent_basis',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'reference_notified',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'reference_notified_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'contactability_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'verification_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'PrivacyProcessingPurpose',
    tableName: 'privacy_processing_purposes',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'purpose_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'purpose_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'legal_basis',
        spec: {
          kind: 'STRING',
          length: 160,
          allowNull: true,
        },
      },
      {
        name: 'description',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'requires_explicit_consent',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'ConsentDocument',
    tableName: 'consent_documents',
    stereotypes: ['versioned'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'document_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'version_code',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'language',
        spec: {
          kind: 'STRING',
          length: 10,
          allowNull: true,
        },
      },
      {
        name: 'effective_from',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: 'effective_until',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: 'content_url',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'content_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'requires_explicit_action',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'published_by_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'published_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'CustomerConsent',
    tableName: 'customer_consents',
    stereotypes: ['versioned'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'consent_document_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'purpose_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'granted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'granted_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'revoked_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'channel',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'ip_address',
        spec: {
          kind: 'INET',
          allowNull: true,
        },
      },
      {
        name: 'device_fingerprint_snapshot',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'user_agent',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'evidence_snapshot_url',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'ConsentEvent',
    tableName: 'consent_events',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_consent_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'happened_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'channel',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'ip_address',
        spec: {
          kind: 'INET',
          allowNull: true,
        },
      },
      {
        name: 'device_fingerprint_snapshot',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'triggered_by_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'triggered_by_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'DataClassificationPolicy',
    tableName: 'data_classification_policies',
    stereotypes: ['catalog', 'platform-shared', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'classification_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'classification_name',
        spec: {
          kind: 'STRING',
          length: 160,
          allowNull: true,
        },
      },
      {
        name: 'sensitivity_level',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'allowed_storage_modes_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'default_storage_mode',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'default_retention_policy_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'encryption_required',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'hashing_required',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'raw_storage_allowed',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'description',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'SensitiveFieldRule',
    tableName: 'sensitive_field_rules',
    stereotypes: ['catalog', 'platform-shared', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'table_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'field_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'classification_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'storage_mode',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'search_strategy',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'masking_strategy',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'access_policy_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'retention_policy_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'DataSubjectRequest',
    tableName: 'data_subject_requests',
    stereotypes: ['case', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'request_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'request_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'requested_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'due_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'resolved_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'handled_by',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'resolution_notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'EvidenceDocument',
    tableName: 'evidence_documents',
    stereotypes: ['core', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'document_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 's3_bucket',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 's3_key',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'file_hash_sha256',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'mime_type',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'file_size_bytes',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'uploaded_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'uploaded_from_ip',
        spec: {
          kind: 'INET',
          allowNull: true,
        },
      },
      {
        name: 'uploaded_from_session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'uploaded_from_device_fingerprint',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'retention_policy_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'expires_at',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: 'retention_until',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'EvidenceExtraction',
    tableName: 'evidence_extractions',
    stereotypes: ['append-only', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'evidence_document_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'extraction_method',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'extraction_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'extracted_data_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'redacted_extracted_data_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'extracted_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'processing_duration_ms',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'requires_review',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'EvidenceReview',
    tableName: 'evidence_reviews',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'evidence_document_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'reviewed_by',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'review_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'reviewed_corrections_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'rejection_reason_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'reviewed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'GlobalDeviceFingerprint',
    tableName: 'global_device_fingerprints',
    stereotypes: ['platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'device_fingerprint',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'fingerprint_version',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'global_first_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'global_last_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'global_reuse_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'global_risk_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'Device',
    tableName: 'devices',
    stereotypes: ['core'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'global_device_fingerprint_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_fingerprint',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'fingerprint_version',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'first_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'last_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'tenant_reuse_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'risk_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'CustomerDeviceLink',
    tableName: 'customer_device_links',
    stereotypes: ['core'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'link_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'is_primary_device',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'trust_level',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'first_seen_session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'last_seen_session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'first_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'last_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'DeviceSnapshot',
    tableName: 'device_snapshots',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'brand',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'model',
        spec: {
          kind: 'STRING',
          length: 160,
          allowNull: true,
        },
      },
      {
        name: 'os_family',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'os_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'app_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'device_release_year',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'device_age_months',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'device_tier_snapshot',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'estimated_device_value_bs_snapshot',
        spec: {
          kind: 'DECIMAL',
          precision: 14,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'is_rooted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_emulator',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'vpn_detected',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'screen_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'captured_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'DeviceRiskEvent',
    tableName: 'device_risk_events',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'previous_risk_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'new_risk_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'reason_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'supporting_evidence_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'happened_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'SimObservation',
    tableName: 'sim_observations',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'phone_number_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'phone_last_4',
        spec: {
          kind: 'STRING',
          length: 4,
          allowNull: true,
        },
      },
      {
        name: 'carrier_name',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'sim_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'sim_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'phone_line_tenure_months',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'last_sim_swap_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'sim_swap_days_since',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'captured_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'CustomerSession',
    tableName: 'customer_sessions',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_token_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'channel',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'auth_method',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'started_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'ended_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'ip_address',
        spec: {
          kind: 'INET',
          allowNull: true,
        },
      },
      {
        name: 'user_agent',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'gps_lat',
        spec: {
          kind: 'DECIMAL',
          precision: 10,
          scale: 7,
          allowNull: true,
        },
      },
      {
        name: 'gps_lng',
        spec: {
          kind: 'DECIMAL',
          precision: 10,
          scale: 7,
          allowNull: true,
        },
      },
      {
        name: 'gps_accuracy_meters',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'session_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'AuthEvent',
    tableName: 'auth_events',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'login_successful',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'failure_reason_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'occurred_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'ip_address',
        spec: {
          kind: 'INET',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'IpReputationObservation',
    tableName: 'ip_reputation_observations',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'provider_request_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'ip_address',
        spec: {
          kind: 'INET',
          allowNull: true,
        },
      },
      {
        name: 'is_vpn',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_proxy',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_tor',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'country_code',
        spec: {
          kind: 'STRING',
          length: 3,
          allowNull: true,
        },
      },
      {
        name: 'city',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'reputation_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'captured_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'CustomerActionLog',
    tableName: 'customer_action_logs',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'screen_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'action_payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'occurred_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'CustomerActivitySummary',
    tableName: 'customer_activity_summaries',
    stereotypes: ['projection'],
    columns: [
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'first_session_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'last_session_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'first_device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'usual_device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'total_sessions',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'total_devices_seen',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'failed_login_count_7d',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'device_change_count_30d',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'suspicious_ip_count_30d',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'current_risk_level',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'current_trust_tier',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'last_risk_assessment_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'last_risk_assessed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'watchlist_hit_count_lifetime',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'fraud_case_count_lifetime',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'open_manual_review_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'recomputed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'computation_version',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'OnboardingFlow',
    tableName: 'onboarding_flows',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'flow_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'started_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'completed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'abandoned_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'completion_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'total_duration_seconds',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'OnboardingStepEvent',
    tableName: 'onboarding_step_events',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'step_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'event_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'started_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'ended_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'duration_ms',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'error_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'FormFieldInteractionEvent',
    tableName: 'form_field_interaction_events',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'field_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'interaction_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'used_copy_paste',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'correction_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'focus_duration_ms',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'occurred_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'PermissionEvent',
    tableName: 'permission_events',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'permission_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'requested_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'granted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'responded_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'OnboardingBehaviorSummary',
    tableName: 'onboarding_behavior_summaries',
    stereotypes: ['append-only', 'derived'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'completion_time_seconds',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'inter_screen_timing_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'form_error_rate',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'ci_copy_paste_detected',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'abandonment_count_prior',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'permission_grant_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'behavior_cluster_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'bot_likelihood_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'computation_version',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'computed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'OnDeviceComputationRun',
    tableName: 'on_device_computation_runs',
    stereotypes: ['append-only', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'consent_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'algorithm_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'algorithm_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'computation_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'raw_contacts_stored',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'raw_sms_stored',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'integrity_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'computed_at_device',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'received_at_server',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'OnDeviceMetricValue',
    tableName: 'on_device_metric_values',
    stereotypes: ['append-only', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'computation_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'metric_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'value_text',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'value_number',
        spec: {
          kind: 'DECIMAL',
          precision: 18,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'value_boolean',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'value_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'ContextSource',
    tableName: 'context_sources',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'source_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'source_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'reliability_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'refresh_frequency',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'ContextCatalog',
    tableName: 'context_catalogs',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'catalog_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'catalog_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'domain',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'description',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'owner_team',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'ContextCatalogVersion',
    tableName: 'context_catalog_versions',
    stereotypes: ['versioned', 'catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'catalog_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'version_code',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'valid_from',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: 'valid_until',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: 'created_by_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'created_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'approved_by_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'approved_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'approved_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'ContextItem',
    tableName: 'context_items',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'catalog_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'item_code',
        spec: {
          kind: 'STRING',
          length: 140,
          allowNull: true,
        },
      },
      {
        name: 'item_name',
        spec: {
          kind: 'STRING',
          length: 220,
          allowNull: true,
        },
      },
      {
        name: 'item_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'attributes_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'source_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'ContextItemAlias',
    tableName: 'context_item_aliases',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'context_item_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'alias_value',
        spec: {
          kind: 'STRING',
          length: 220,
          allowNull: true,
        },
      },
      {
        name: 'alias_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'normalized_alias',
        spec: {
          kind: 'STRING',
          length: 220,
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'ContextRiskMapping',
    tableName: 'context_risk_mappings',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'context_item_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'risk_band',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'score_points_suggested',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'reason_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'explanation',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'model_usage',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'valid_from',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: 'valid_until',
        spec: {
          kind: 'DATEONLY',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'ContextStagingItem',
    tableName: 'context_staging_items',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'catalog_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'ingestion_job_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'proposed_item_code',
        spec: {
          kind: 'STRING',
          length: 140,
          allowNull: true,
        },
      },
      {
        name: 'proposed_item_name',
        spec: {
          kind: 'STRING',
          length: 220,
          allowNull: true,
        },
      },
      {
        name: 'proposed_attributes_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'ai_suggested',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'review_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'review_notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'created_by_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'created_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'ContextApprovalEvent',
    tableName: 'context_approval_events',
    stereotypes: ['append-only', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'staging_item_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'catalog_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'decided_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'decided_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'decision_reason',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'ContextIngestionJob',
    tableName: 'context_ingestion_jobs',
    stereotypes: ['append-only', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'job_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'source_name',
        spec: {
          kind: 'STRING',
          length: 160,
          allowNull: true,
        },
      },
      {
        name: 'triggered_by_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'triggered_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'started_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'finished_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'summary_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'ObservationDefinition',
    tableName: 'observation_definitions',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'observation_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'observation_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'data_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'source_group',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'expected_availability_stage',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'build_phase',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'data_classification_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'requires_consent',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'allowed_for_credit_decision',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'allowed_for_fraud_decision',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'legal_review_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'prohibited_reason_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'fairness_review_required',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'retention_policy_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'EventDefinition',
    tableName: 'event_definitions',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'event_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'event_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'event_family',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'source_package',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_tables_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'expected_payload_schema_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'build_phase',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'data_classification_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'retention_policy_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'is_high_volume',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'CustomerObservation',
    tableName: 'customer_observations',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'observation_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'value_text',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'value_number',
        spec: {
          kind: 'DECIMAL',
          precision: 18,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'value_boolean',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'value_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'source_provider_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'evidence_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'verification_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'captured_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'valid_from',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'valid_until',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'derivation_method',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'derivation_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'AttributeDefinition',
    tableName: 'attribute_definitions',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'attribute_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'attribute_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'entity_scope',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'data_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'availability_stage',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'build_phase',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'data_classification_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'requires_consent',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_sensitive',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_model_candidate',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'allowed_for_credit_decision',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'allowed_for_fraud_decision',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'legal_review_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'prohibited_reason_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'fairness_review_required',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'retention_policy_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'CustomerAttributeValue',
    tableName: 'customer_attribute_values',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'attribute_definition_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'value_text',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'value_number',
        spec: {
          kind: 'DECIMAL',
          precision: 18,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'value_boolean',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'value_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'evidence_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'verification_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'valid_from',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'valid_until',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'CustomerContextEnrichment',
    tableName: 'customer_context_enrichments',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'observation_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'catalog_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'catalog_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'matched_context_item_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'catalog_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'catalog_version_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'matched_item_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 140,
          allowNull: true,
        },
      },
      {
        name: 'matched_item_name_snapshot',
        spec: {
          kind: 'STRING',
          length: 220,
          allowNull: true,
        },
      },
      {
        name: 'enrichment_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'enrichment_value_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'match_method',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'FeatureDefinition',
    tableName: 'feature_definitions',
    stereotypes: ['catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'feature_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'feature_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'feature_family',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'data_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'availability_tier',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'build_phase',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'data_classification_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'calculation_kind',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'default_missing_strategy',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'is_model_input',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_policy_rule_input',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_sensitive',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'allowed_for_credit_decision',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'allowed_for_fraud_decision',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'legal_review_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'prohibited_reason_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'fairness_review_required',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'retention_policy_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'owner_team',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'FeatureComputationRun',
    tableName: 'feature_computation_runs',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'subject_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'subject_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'run_reason',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'trigger_source',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'idempotency_key',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'feature_set_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'code_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'computed_by',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'retry_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'started_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'finished_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'error_message',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'FeatureValue',
    tableName: 'feature_values',
    stereotypes: ['append-only', 'derived'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'computation_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'feature_definition_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'subject_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'subject_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'value_text',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'value_number',
        spec: {
          kind: 'DECIMAL',
          precision: 18,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'value_boolean',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'value_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'derivation_method',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'derivation_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'valid_from',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'valid_until',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'FeatureLineageLink',
    tableName: 'feature_lineage_links',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'feature_value_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'source_table',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'source_record_id',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'source_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'source_snapshot_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'contribution_weight',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'FeatureSnapshot',
    tableName: 'feature_snapshots',
    stereotypes: ['snapshot'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'subject_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'subject_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'snapshot_reason',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'triggering_entity_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'triggering_entity_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'feature_set_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'catalog_versions_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'features_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'missing_features_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'integrity_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'RiskModelVersion',
    tableName: 'risk_model_versions',
    stereotypes: ['versioned', 'catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'model_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'version_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'model_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'assessment_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'effective_from',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'effective_until',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'approved_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'approved_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'artifact_url',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'artifact_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'RiskRulesetVersion',
    tableName: 'risk_ruleset_versions',
    stereotypes: ['versioned', 'catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'ruleset_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'version_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'assessment_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'effective_from',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'effective_until',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'approved_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'approved_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'RiskPolicyRule',
    tableName: 'risk_policy_rules',
    stereotypes: ['versioned', 'catalog', 'platform-shared'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'ruleset_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'rule_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'rule_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'rule_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'severity',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'expression_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'action_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'reason_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'is_hard_stop',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'RiskAssessmentRun',
    tableName: 'risk_assessment_runs',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'subject_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'subject_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'feature_snapshot_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_model_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_ruleset_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'assessment_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'trigger_source',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'idempotency_key',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'run_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'started_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'completed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'latency_ms',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'RiskAssessmentContext',
    tableName: 'risk_assessment_contexts',
    stereotypes: ['snapshot'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'context_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'external_entity_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'external_entity_id',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'merchant_id_snapshot',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'merchant_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'merchant_risk_band_snapshot',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'merchant_default_rate_snapshot',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'store_id_snapshot',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'product_category_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'product_subcategory_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'basket_item_count_snapshot',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'basket_duplicate_item_count_snapshot',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'basket_anomaly_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'transaction_amount_snapshot',
        spec: {
          kind: 'DECIMAL',
          precision: 14,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'currency_code',
        spec: {
          kind: 'STRING',
          length: 3,
          allowNull: true,
        },
      },
      {
        name: 'purchase_to_declared_income_ratio',
        spec: {
          kind: 'DECIMAL',
          precision: 10,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'down_payment_required_pct_snapshot',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'down_payment_behavior_snapshot',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'store_to_home_distance_meters',
        spec: {
          kind: 'DECIMAL',
          precision: 12,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'context_payload_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'RiskRuleFired',
    tableName: 'risk_rules_fired',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_policy_rule_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'rule_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'ruleset_version_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'input_values_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'output_action',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'reason_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'severity',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'is_hard_stop',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'fired_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'RiskFeatureContribution',
    tableName: 'risk_feature_contributions',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'feature_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'raw_value_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'bin_or_attribute',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'woe_value',
        spec: {
          kind: 'DECIMAL',
          precision: 12,
          scale: 6,
          allowNull: true,
        },
      },
      {
        name: 'score_points',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'reason_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'RiskAssessmentResult',
    tableName: 'risk_assessment_results',
    stereotypes: ['snapshot'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'subject_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'subject_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'assessment_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'recommended_action',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'risk_level',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'score_total',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'fraud_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'identity_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'device_risk_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'behavior_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'contactability_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'consistency_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'reason_codes_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'model_version_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'ruleset_version_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'feature_snapshot_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'integrity_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'decided_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'ManualReviewCase',
    tableName: 'manual_review_cases',
    stereotypes: ['case'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'case_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'fraud_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'case_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'priority',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'assigned_to_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'opened_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'closed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'resolution',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'ManualReviewEvent',
    tableName: 'manual_review_events',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'manual_review_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'actor_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'actor_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'happened_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'FraudCase',
    tableName: 'fraud_cases',
    stereotypes: ['case'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'case_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'primary_device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'escalated_from_review_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'case_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'severity',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'pattern_detected',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'linked_customers_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'linked_sessions_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'linked_devices_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'assigned_to_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'opened_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'closed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'resolution',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'FraudCaseEvent',
    tableName: 'fraud_case_events',
    stereotypes: ['append-only'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'fraud_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'actor_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'actor_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'happened_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'WatchlistEntry',
    tableName: 'watchlist_entries',
    stereotypes: ['core', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'scope',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'country_code',
        spec: {
          kind: 'STRING',
          length: 3,
          allowNull: true,
        },
      },
      {
        name: 'entity_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'entity_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'entity_last_4',
        spec: {
          kind: 'STRING',
          length: 4,
          allowNull: true,
        },
      },
      {
        name: 'reason_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'severity',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'created_by_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'created_by_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'created_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'expires_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'WatchlistMatch',
    tableName: 'watchlist_matches',
    stereotypes: ['append-only', 'privacy'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'watchlist_entry_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'matched_entity_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'matched_value_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'match_method',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'match_confidence',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'opened_review_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'opened_fraud_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'matched_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'DataChangeLog',
    tableName: 'data_change_logs',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'table_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'record_id',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'change_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'changed_by_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'changed_by_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'changed_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'old_values_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'new_values_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'change_reason',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'changed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'OperationalAuditLog',
    tableName: 'operational_audit_logs',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'actor_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'actor_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'actor_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'action_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_type',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_id',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'ip_address',
        spec: {
          kind: 'INET',
          allowNull: true,
        },
      },
      {
        name: 'user_agent',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'occurred_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'RiskSignalSeed',
    tableName: 'risk_signal_seeds',
    stereotypes: ['catalog', 'platform-shared', 'roadmap'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'signal_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'signal_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'signal_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'source_entity',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_definition_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'build_phase',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'priority',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'expected_direction',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'example_value_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'rationale',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'DataQualityRule',
    tableName: 'data_quality_rules',
    stereotypes: ['catalog', 'platform-shared', 'quality'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'rule_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'rule_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'target_table',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_field',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'severity',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'expression_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'expected_action',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'build_phase',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'DataQualityIssue',
    tableName: 'data_quality_issues',
    stereotypes: ['append-only', 'quality'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'quality_rule_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'target_table',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_record_id',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'issue_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'detected_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'resolved_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'resolution_notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'SchemaConstraintNote',
    tableName: 'schema_constraint_notes',
    stereotypes: ['catalog', 'platform-shared', 'quality'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'table_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'constraint_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'constraint_expression',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'rationale',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'build_phase',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'is_required_for_mvp',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
];

const FOREIGN_KEYS: ForeignKeySpec[] = [
  {
    table: 'internal_users',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'data_providers',
    column: 'default_retention_policy_id',
    targetTable: 'retention_policies',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_provider_requests',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'data_provider_requests',
    column: 'provider_id',
    targetTable: 'data_providers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_provider_requests',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_provider_requests',
    column: 'risk_assessment_run_id',
    targetTable: 'risk_assessment_runs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_provider_requests',
    column: 'consent_id',
    targetTable: 'customer_consents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_provider_responses',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'data_provider_responses',
    column: 'provider_request_id',
    targetTable: 'data_provider_requests',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_provider_responses',
    column: 'retention_policy_id',
    targetTable: 'retention_policies',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customers',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customers',
    column: 'current_profile_version_id',
    targetTable: 'customer_profile_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_status_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_status_events',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_status_events',
    column: 'changed_by_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_status_events',
    column: 'changed_by_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_profile_versions',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_profile_versions',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_profile_versions',
    column: 'supersedes_version_id',
    targetTable: 'customer_profile_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_identity_documents',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_identity_documents',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_identity_documents',
    column: 'front_evidence_id',
    targetTable: 'evidence_documents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_identity_documents',
    column: 'back_evidence_id',
    targetTable: 'evidence_documents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'identity_verification_attempts',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'identity_verification_attempts',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'identity_verification_attempts',
    column: 'identity_document_id',
    targetTable: 'customer_identity_documents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'identity_verification_attempts',
    column: 'provider_request_id',
    targetTable: 'data_provider_requests',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'identity_verification_attempts',
    column: 'consent_id',
    targetTable: 'customer_consents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'identity_verification_attempts',
    column: 'selfie_evidence_id',
    targetTable: 'evidence_documents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'identity_verification_attempts',
    column: 'manual_reviewed_by',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_contact_methods',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_contact_methods',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'contact_verification_attempts',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'contact_verification_attempts',
    column: 'contact_method_id',
    targetTable: 'customer_contact_methods',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'contact_verification_attempts',
    column: 'provider_request_id',
    targetTable: 'data_provider_requests',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_addresses',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_addresses',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_addresses',
    column: 'current_version_id',
    targetTable: 'customer_address_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_address_versions',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_address_versions',
    column: 'customer_address_id',
    targetTable: 'customer_addresses',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_address_versions',
    column: 'evidence_id',
    targetTable: 'evidence_documents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_address_versions',
    column: 'supersedes_version_id',
    targetTable: 'customer_address_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'address_gps_observations',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'address_gps_observations',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'address_gps_observations',
    column: 'customer_address_id',
    targetTable: 'customer_addresses',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'address_gps_observations',
    column: 'address_version_id',
    targetTable: 'customer_address_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'address_gps_observations',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_reference_contacts',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_reference_contacts',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'consent_documents',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'consent_documents',
    column: 'published_by_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_consents',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_consents',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_consents',
    column: 'consent_document_id',
    targetTable: 'consent_documents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_consents',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'consent_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'consent_events',
    column: 'customer_consent_id',
    targetTable: 'customer_consents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'consent_events',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_classification_policies',
    column: 'default_retention_policy_id',
    targetTable: 'retention_policies',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'sensitive_field_rules',
    column: 'retention_policy_id',
    targetTable: 'retention_policies',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_subject_requests',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'data_subject_requests',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_subject_requests',
    column: 'handled_by',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'evidence_documents',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'evidence_documents',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'evidence_documents',
    column: 'uploaded_from_session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'evidence_documents',
    column: 'retention_policy_id',
    targetTable: 'retention_policies',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'evidence_extractions',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'evidence_extractions',
    column: 'evidence_document_id',
    targetTable: 'evidence_documents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'evidence_reviews',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'evidence_reviews',
    column: 'evidence_document_id',
    targetTable: 'evidence_documents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'evidence_reviews',
    column: 'reviewed_by',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'devices',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'devices',
    column: 'global_device_fingerprint_id',
    targetTable: 'global_device_fingerprints',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_device_links',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_device_links',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_device_links',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_device_links',
    column: 'first_seen_session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_device_links',
    column: 'last_seen_session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'device_snapshots',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'device_snapshots',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'device_snapshots',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'device_snapshots',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'device_risk_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'device_risk_events',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'sim_observations',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'sim_observations',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'sim_observations',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'sim_observations',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_sessions',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_sessions',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_sessions',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'auth_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'auth_events',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'auth_events',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'auth_events',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'ip_reputation_observations',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'ip_reputation_observations',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'ip_reputation_observations',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'ip_reputation_observations',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'ip_reputation_observations',
    column: 'provider_request_id',
    targetTable: 'data_provider_requests',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_action_logs',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_action_logs',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_action_logs',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_action_logs',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_activity_summaries',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_activity_summaries',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_activity_summaries',
    column: 'first_device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_activity_summaries',
    column: 'usual_device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_activity_summaries',
    column: 'last_risk_assessment_id',
    targetTable: 'risk_assessment_results',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'onboarding_flows',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'onboarding_flows',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'onboarding_flows',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'onboarding_step_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'onboarding_step_events',
    column: 'onboarding_flow_id',
    targetTable: 'onboarding_flows',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'form_field_interaction_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'form_field_interaction_events',
    column: 'onboarding_flow_id',
    targetTable: 'onboarding_flows',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'permission_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'permission_events',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'permission_events',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'permission_events',
    column: 'onboarding_flow_id',
    targetTable: 'onboarding_flows',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'onboarding_behavior_summaries',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'onboarding_behavior_summaries',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'onboarding_behavior_summaries',
    column: 'onboarding_flow_id',
    targetTable: 'onboarding_flows',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'on_device_computation_runs',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'on_device_computation_runs',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'on_device_computation_runs',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'on_device_computation_runs',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'on_device_computation_runs',
    column: 'onboarding_flow_id',
    targetTable: 'onboarding_flows',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'on_device_computation_runs',
    column: 'consent_id',
    targetTable: 'customer_consents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'on_device_metric_values',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'on_device_metric_values',
    column: 'computation_run_id',
    targetTable: 'on_device_computation_runs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_catalog_versions',
    column: 'catalog_id',
    targetTable: 'context_catalogs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_catalog_versions',
    column: 'created_by_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_catalog_versions',
    column: 'approved_by_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_items',
    column: 'catalog_version_id',
    targetTable: 'context_catalog_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_items',
    column: 'source_id',
    targetTable: 'context_sources',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_item_aliases',
    column: 'context_item_id',
    targetTable: 'context_items',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_risk_mappings',
    column: 'context_item_id',
    targetTable: 'context_items',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_staging_items',
    column: 'catalog_id',
    targetTable: 'context_catalogs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_staging_items',
    column: 'ingestion_job_id',
    targetTable: 'context_ingestion_jobs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_staging_items',
    column: 'created_by_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_approval_events',
    column: 'staging_item_id',
    targetTable: 'context_staging_items',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_approval_events',
    column: 'catalog_version_id',
    targetTable: 'context_catalog_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'context_approval_events',
    column: 'decided_by_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'observation_definitions',
    column: 'retention_policy_id',
    targetTable: 'retention_policies',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'event_definitions',
    column: 'retention_policy_id',
    targetTable: 'retention_policies',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_observations',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_observations',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_observations',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_observations',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_observations',
    column: 'source_provider_id',
    targetTable: 'data_providers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_observations',
    column: 'evidence_id',
    targetTable: 'evidence_documents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'attribute_definitions',
    column: 'retention_policy_id',
    targetTable: 'retention_policies',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_attribute_values',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_attribute_values',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_attribute_values',
    column: 'attribute_definition_id',
    targetTable: 'attribute_definitions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_attribute_values',
    column: 'evidence_id',
    targetTable: 'evidence_documents',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_context_enrichments',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_context_enrichments',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_context_enrichments',
    column: 'observation_id',
    targetTable: 'customer_observations',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_context_enrichments',
    column: 'catalog_id',
    targetTable: 'context_catalogs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_context_enrichments',
    column: 'catalog_version_id',
    targetTable: 'context_catalog_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_context_enrichments',
    column: 'matched_context_item_id',
    targetTable: 'context_items',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_definitions',
    column: 'retention_policy_id',
    targetTable: 'retention_policies',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_computation_runs',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'feature_computation_runs',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_computation_runs',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_computation_runs',
    column: 'onboarding_flow_id',
    targetTable: 'onboarding_flows',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_computation_runs',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_values',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'feature_values',
    column: 'computation_run_id',
    targetTable: 'feature_computation_runs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_values',
    column: 'feature_definition_id',
    targetTable: 'feature_definitions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_values',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_values',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_values',
    column: 'onboarding_flow_id',
    targetTable: 'onboarding_flows',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_values',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_lineage_links',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'feature_lineage_links',
    column: 'feature_value_id',
    targetTable: 'feature_values',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_snapshots',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'feature_snapshots',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_snapshots',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_snapshots',
    column: 'risk_assessment_run_id',
    targetTable: 'risk_assessment_runs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_snapshots',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'feature_snapshots',
    column: 'onboarding_flow_id',
    targetTable: 'onboarding_flows',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_model_versions',
    column: 'approved_by_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_ruleset_versions',
    column: 'approved_by_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_policy_rules',
    column: 'ruleset_version_id',
    targetTable: 'risk_ruleset_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_runs',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'risk_assessment_runs',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_runs',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_runs',
    column: 'onboarding_flow_id',
    targetTable: 'onboarding_flows',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_runs',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_runs',
    column: 'feature_snapshot_id',
    targetTable: 'feature_snapshots',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_runs',
    column: 'risk_model_version_id',
    targetTable: 'risk_model_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_runs',
    column: 'risk_ruleset_version_id',
    targetTable: 'risk_ruleset_versions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_contexts',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'risk_assessment_contexts',
    column: 'risk_assessment_run_id',
    targetTable: 'risk_assessment_runs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_rules_fired',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'risk_rules_fired',
    column: 'risk_assessment_run_id',
    targetTable: 'risk_assessment_runs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_rules_fired',
    column: 'risk_policy_rule_id',
    targetTable: 'risk_policy_rules',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_feature_contributions',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'risk_feature_contributions',
    column: 'risk_assessment_run_id',
    targetTable: 'risk_assessment_runs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_results',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'risk_assessment_results',
    column: 'risk_assessment_run_id',
    targetTable: 'risk_assessment_runs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_results',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_results',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_results',
    column: 'onboarding_flow_id',
    targetTable: 'onboarding_flows',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_results',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'risk_assessment_results',
    column: 'feature_snapshot_id',
    targetTable: 'feature_snapshots',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'manual_review_cases',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'manual_review_cases',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'manual_review_cases',
    column: 'risk_assessment_run_id',
    targetTable: 'risk_assessment_runs',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'manual_review_cases',
    column: 'fraud_case_id',
    targetTable: 'fraud_cases',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'manual_review_cases',
    column: 'assigned_to_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'manual_review_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'manual_review_events',
    column: 'manual_review_case_id',
    targetTable: 'manual_review_cases',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'manual_review_events',
    column: 'actor_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'fraud_cases',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'fraud_cases',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'fraud_cases',
    column: 'primary_device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'fraud_cases',
    column: 'escalated_from_review_case_id',
    targetTable: 'manual_review_cases',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'fraud_cases',
    column: 'assigned_to_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'fraud_case_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'fraud_case_events',
    column: 'fraud_case_id',
    targetTable: 'fraud_cases',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'fraud_case_events',
    column: 'actor_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'watchlist_entries',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'watchlist_entries',
    column: 'created_by_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'watchlist_entries',
    column: 'created_by_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'watchlist_matches',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'watchlist_matches',
    column: 'watchlist_entry_id',
    targetTable: 'watchlist_entries',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'watchlist_matches',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'watchlist_matches',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'watchlist_matches',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'watchlist_matches',
    column: 'opened_review_case_id',
    targetTable: 'manual_review_cases',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'watchlist_matches',
    column: 'opened_fraud_case_id',
    targetTable: 'fraud_cases',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_change_logs',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'data_change_logs',
    column: 'changed_by_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_change_logs',
    column: 'changed_by_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'operational_audit_logs',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'operational_audit_logs',
    column: 'actor_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'operational_audit_logs',
    column: 'actor_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_quality_issues',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_quality_issues',
    column: 'quality_rule_id',
    targetTable: 'data_quality_rules',
    targetColumn: '_id',
    allowNull: true,
  },
];

const INDEXES: IndexSpec[] = [
  {
    table: 'internal_users',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'data_provider_requests',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'data_provider_responses',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customers',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'customer_status_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_profile_versions',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_identity_documents',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'identity_verification_attempts',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_contact_methods',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'contact_verification_attempts',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_addresses',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'customer_address_versions',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'address_gps_observations',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_reference_contacts',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'consent_documents',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_consents',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'consent_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'data_subject_requests',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'evidence_documents',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'evidence_extractions',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'evidence_reviews',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'devices',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'customer_device_links',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'device_snapshots',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'device_risk_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'sim_observations',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_sessions',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'auth_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'ip_reputation_observations',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_action_logs',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_activity_summaries',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'onboarding_flows',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'onboarding_step_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'form_field_interaction_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'permission_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'onboarding_behavior_summaries',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'on_device_computation_runs',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'on_device_metric_values',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_observations',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_attribute_values',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_context_enrichments',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'feature_computation_runs',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'feature_values',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'feature_lineage_links',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'feature_snapshots',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'risk_assessment_runs',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'risk_assessment_contexts',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'risk_rules_fired',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'risk_feature_contributions',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'risk_assessment_results',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'manual_review_cases',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'manual_review_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'fraud_cases',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'fraud_case_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'watchlist_entries',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'watchlist_matches',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'data_change_logs',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'operational_audit_logs',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'data_quality_issues',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'tenants',
    fields: ['tenant_code'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'platform_users',
    fields: ['user_code'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'platform_users',
    fields: ['email'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'internal_users',
    fields: ['_tenant_id', 'user_code'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'retention_policies',
    fields: ['policy_code'],
    where: null,
    unique: true,
  },
  {
    table: 'data_providers',
    fields: ['provider_code'],
    where: null,
    unique: true,
  },
  {
    table: 'customers',
    fields: ['_tenant_id', 'customer_code'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'customers',
    fields: ['customer_uuid'],
    where: null,
    unique: true,
  },
  {
    table: 'customers',
    fields: ['_tenant_id', 'primary_phone_hash'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'privacy_processing_purposes',
    fields: ['purpose_code'],
    where: null,
    unique: true,
  },
  {
    table: 'data_classification_policies',
    fields: ['classification_code'],
    where: null,
    unique: true,
  },
  {
    table: 'data_subject_requests',
    fields: ['_tenant_id', 'request_code'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'global_device_fingerprints',
    fields: ['device_fingerprint'],
    where: null,
    unique: true,
  },
  {
    table: 'devices',
    fields: ['_tenant_id', 'device_fingerprint'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'context_sources',
    fields: ['source_code'],
    where: null,
    unique: true,
  },
  {
    table: 'context_catalogs',
    fields: ['catalog_code'],
    where: null,
    unique: true,
  },
  {
    table: 'observation_definitions',
    fields: ['observation_code'],
    where: null,
    unique: true,
  },
  {
    table: 'event_definitions',
    fields: ['event_code'],
    where: null,
    unique: true,
  },
  {
    table: 'attribute_definitions',
    fields: ['attribute_code'],
    where: null,
    unique: true,
  },
  {
    table: 'feature_definitions',
    fields: ['feature_code'],
    where: null,
    unique: true,
  },
  {
    table: 'manual_review_cases',
    fields: ['_tenant_id', 'case_code'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'fraud_cases',
    fields: ['_tenant_id', 'case_code'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'risk_signal_seeds',
    fields: ['signal_code'],
    where: null,
    unique: true,
  },
  {
    table: 'data_quality_rules',
    fields: ['rule_code'],
    where: null,
    unique: true,
  },
  {
    table: 'customers',
    fields: ['primary_email_hash'],
    where: '_deleted = false',
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_profile_versions',
    fields: ['customer_id', 'valid_until'],
    where: 'valid_until IS NULL',
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_identity_documents',
    fields: ['customer_id', 'valid_until'],
    where: 'valid_until IS NULL',
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_identity_documents',
    fields: ['declared_number_hash'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_identity_documents',
    fields: ['verified_number_hash'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_addresses',
    fields: ['customer_id'],
    where: '_deleted = false',
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_address_versions',
    fields: ['customer_address_id', 'valid_until'],
    where: 'valid_until IS NULL',
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_contact_methods',
    fields: ['contact_value_hash'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_contact_methods',
    fields: ['normalized_value_hash'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_reference_contacts',
    fields: ['phone_hash'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'watchlist_entries',
    fields: ['entity_hash'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'watchlist_entries',
    fields: ['scope', 'country_code', 'entity_type'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'devices',
    fields: ['global_device_fingerprint_id'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_device_links',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "last_seen_at" DESC',
  },
  {
    table: 'device_snapshots',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"device_id", "captured_at" DESC',
  },
  {
    table: 'customer_sessions',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "started_at" DESC',
  },
  {
    table: 'auth_events',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "occurred_at" DESC',
  },
  {
    table: 'ip_reputation_observations',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"ip_address", "captured_at" DESC',
  },
  {
    table: 'customer_observations',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"_tenant_id", "customer_id", "captured_at" DESC',
  },
  {
    table: 'customer_observations',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"observation_code", "captured_at" DESC',
  },
  {
    table: 'customer_observations',
    fields: ['value_json'],
    where: null,
    unique: false,
    using: 'gin',
    rawColumns: null,
  },
  {
    table: 'feature_values',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "valid_from" DESC',
  },
  {
    table: 'feature_values',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"feature_definition_id", "valid_from" DESC',
  },
  {
    table: 'feature_snapshots',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "_created_at" DESC',
  },
  {
    table: 'feature_snapshots',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"subject_type", "subject_id", "_created_at" DESC',
  },
  {
    table: 'feature_snapshots',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"session_id", "_created_at" DESC',
  },
  {
    table: 'feature_snapshots',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"onboarding_flow_id", "_created_at" DESC',
  },
  {
    table: 'feature_snapshots',
    fields: ['features_json'],
    where: null,
    unique: false,
    using: 'gin',
    rawColumns: null,
  },
  {
    table: 'feature_snapshots',
    fields: ['risk_assessment_run_id'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'context_items',
    fields: ['catalog_version_id', 'item_code'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'context_item_aliases',
    fields: ['normalized_alias'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'context_items',
    fields: ['attributes_json'],
    where: null,
    unique: false,
    using: 'gin',
    rawColumns: null,
  },
  {
    table: 'risk_assessment_runs',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "started_at" DESC',
  },
  {
    table: 'risk_assessment_runs',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"subject_type", "subject_id", "started_at" DESC',
  },
  {
    table: 'risk_assessment_runs',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"session_id", "started_at" DESC',
  },
  {
    table: 'risk_assessment_runs',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"onboarding_flow_id", "started_at" DESC',
  },
  {
    table: 'risk_assessment_results',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "decided_at" DESC',
  },
  {
    table: 'risk_assessment_results',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"subject_type", "subject_id", "decided_at" DESC',
  },
  {
    table: 'risk_assessment_results',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"risk_level", "decided_at" DESC',
  },
  {
    table: 'risk_assessment_contexts',
    fields: ['risk_assessment_run_id'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'risk_assessment_contexts',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"merchant_id_snapshot", "_created_at" DESC',
  },
  {
    table: 'risk_assessment_contexts',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"product_category_snapshot", "_created_at" DESC',
  },
  {
    table: 'risk_rules_fired',
    fields: ['risk_assessment_run_id'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'risk_feature_contributions',
    fields: ['risk_assessment_run_id'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'manual_review_cases',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"status", "opened_at" DESC',
  },
  {
    table: 'manual_review_cases',
    fields: ['assigned_to_internal_user_id', 'status'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'fraud_cases',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"case_status", "opened_at" DESC',
  },
  {
    table: 'fraud_cases',
    fields: ['customer_id'],
    where: '_deleted = false',
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'watchlist_matches',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "matched_at" DESC',
  },
  {
    table: 'watchlist_matches',
    fields: ['watchlist_entry_id'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'data_change_logs',
    fields: ['table_name', 'record_id'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'data_change_logs',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"_tenant_id", "changed_at" DESC',
  },
  {
    table: 'operational_audit_logs',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"actor_internal_user_id", "occurred_at" DESC',
  },
];

const CHECK_CONSTRAINTS: Array<{ table: string; name: string; expression: string }> = [
  {
    table: 'watchlist_entries',
    name: 'ck_watchlist_entries_scope_consistency',
    expression: `(
      (scope = 'global' AND _tenant_id IS NULL AND country_code IS NULL)
      OR (scope = 'country' AND _tenant_id IS NULL AND country_code IS NOT NULL)
      OR (scope = 'tenant' AND _tenant_id IS NOT NULL)
      OR scope IS NULL
    )`,
  },
  {
    table: 'on_device_computation_runs',
    name: 'ck_on_device_no_raw_contacts_or_sms',
    expression: '(raw_contacts_stored IS FALSE AND raw_sms_stored IS FALSE)',
  },
  {
    table: 'risk_assessment_runs',
    name: 'ck_risk_assessment_subject_present',
    expression: 'customer_id IS NOT NULL OR session_id IS NOT NULL OR onboarding_flow_id IS NOT NULL OR device_id IS NOT NULL',
  },
  {
    table: 'evidence_documents',
    name: 'ck_evidence_document_not_orphan',
    expression: 'customer_id IS NOT NULL OR uploaded_from_session_id IS NOT NULL',
  },
  {
    table: 'data_provider_responses',
    name: 'ck_data_provider_response_payload_strategy',
    expression: `(
      payload_storage_strategy IS NULL
      OR (payload_storage_strategy = 'inline_full' AND response_payload_json IS NOT NULL)
      OR (payload_storage_strategy = 'inline_redacted' AND redacted_payload_json IS NOT NULL)
      OR (payload_storage_strategy = 's3_raw' AND raw_payload_s3_key IS NOT NULL)
      OR (payload_storage_strategy = 'hashed_only' AND response_payload_json IS NULL AND redacted_payload_json IS NULL AND raw_payload_s3_key IS NULL)
    )`,
  },
];

function resolveColumnType(spec: ColumnSpec): ModelAttributeColumnOptions<Model>['type'] {
  switch (spec.kind) {
    case 'BIGINT':
      return DataTypes.BIGINT;
    case 'STRING':
      return DataTypes.STRING(spec.length);
    case 'TEXT':
      return DataTypes.TEXT;
    case 'BOOLEAN':
      return DataTypes.BOOLEAN;
    case 'INTEGER':
      return DataTypes.INTEGER;
    case 'DECIMAL':
      return spec.precision && spec.scale !== undefined ? DataTypes.DECIMAL(spec.precision, spec.scale) : DataTypes.DECIMAL;
    case 'DATE':
      return DataTypes.DATE;
    case 'DATEONLY':
      return DataTypes.DATEONLY;
    case 'UUID':
      return DataTypes.UUID;
    case 'JSONB':
      return DataTypes.JSONB;
    case 'BLOB':
      return DataTypes.BLOB;
    case 'INET':
      return DataTypes.INET;
  }
}

function buildColumns(table: TableSpec): ModelAttributes<Model> {
  const columns: Record<string, ModelAttributeColumnOptions<Model>> = {};

  for (const column of table.columns) {
    columns[column.name] = {
      type: resolveColumnType(column.spec),
      allowNull: column.spec.allowNull,
    };

    if (column.spec.primaryKey) {
      columns[column.name].primaryKey = true;
    }

    if (column.spec.autoIncrement) {
      columns[column.name].autoIncrement = true;
    }

    if (column.spec.comment) {
      columns[column.name].comment = column.spec.comment;
    }
  }

  return columns as unknown as ModelAttributes<Model>;
}

function shortenName(name: string): string {
  if (name.length <= 58) {
    return name;
  }

  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }

  return `${name.slice(0, 47)}_${hash.toString(16).padStart(8, '0')}`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function indexColumns(index: IndexSpec): string {
  if (index.rawColumns) {
    return index.rawColumns;
  }

  return (index.fields ?? []).map(quoteIdentifier).join(', ');
}

function indexName(index: IndexSpec): string {
  const raw = index.rawColumns ? index.rawColumns.replace(/[^a-zA-Z0-9]+/g, '_') : (index.fields ?? []).join('_');

  const prefix = index.unique ? 'ux' : 'idx';
  const usingSuffix = index.using ? `_${index.using}` : '';

  return shortenName(`${prefix}_${index.table}_${raw}${usingSuffix}`);
}

async function createIndexes(queryInterface: QueryInterface): Promise<void> {
  for (const index of INDEXES) {
    const uniqueSql = index.unique ? 'UNIQUE ' : '';
    const usingSql = index.using ? ` USING ${index.using.toUpperCase()}` : '';
    const whereSql = index.where ? ` WHERE ${index.where}` : '';

    await queryInterface.sequelize.query(
      `CREATE ${uniqueSql}INDEX IF NOT EXISTS ${quoteIdentifier(indexName(index))} ON ${quoteIdentifier(index.table)}${usingSql} (${indexColumns(index)})${whereSql};`,
    );
  }
}

async function addForeignKeys(queryInterface: QueryInterface): Promise<void> {
  for (const foreignKey of FOREIGN_KEYS) {
    const constraintName = shortenName(`fk_${foreignKey.table}_${foreignKey.column}`);

    await queryInterface.addConstraint(foreignKey.table, {
      fields: [foreignKey.column],
      type: 'foreign key',
      name: constraintName,
      references: {
        table: foreignKey.targetTable,
        field: foreignKey.targetColumn,
      },
      onUpdate: 'CASCADE',
      onDelete: foreignKey.allowNull ? 'SET NULL' : 'RESTRICT',
    });
  }
}

async function addChecks(queryInterface: QueryInterface): Promise<void> {
  for (const constraint of CHECK_CONSTRAINTS) {
    await queryInterface.sequelize.query(
      `ALTER TABLE ${quoteIdentifier(constraint.table)} ADD CONSTRAINT ${quoteIdentifier(constraint.name)} CHECK (${constraint.expression});`,
    );
  }
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const table of TABLES) {
      await queryInterface.createTable(table.tableName, buildColumns(table), { transaction });
    }
  });

  await addForeignKeys(queryInterface);
  await addChecks(queryInterface);
  await createIndexes(queryInterface);
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const table of [...TABLES].reverse()) {
      await queryInterface.dropTable(table.tableName, { cascade: true, transaction });
    }
  });
}
