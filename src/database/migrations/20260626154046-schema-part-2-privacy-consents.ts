import { QueryInterface } from 'sequelize';
import { buildColumns, TableSpec } from '../migration-support/atlas-schema-builder.util.js';

/**
 * ATLAS-P11-T09: parte 3/10 del split de la migración inicial monolítica
 * (`20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts`, 12,554 líneas,
 * eliminada por este patch). Dominio: **privacy-consents** (10 tablas).
 *
 * Esta migración SOLO crea tablas (`CREATE TABLE`) — sin foreign keys, índices ni check
 * constraints, exactamente como hacía la migración original en su primera fase (`up()` original:
 * loop de `createTable` seguido de `addForeignKeys`/`addChecks`/`createIndexes` como fases
 * separadas). Esa misma separación se preserva aquí a nivel de archivo: las 10 migraciones de
 * "parte" (`schema-part-*`) crean únicamente tablas; `schema-relationships` (que corre después
 * de las 10) agrega TODAS las foreign keys, checks e índices de las 86 tablas en un solo paso,
 * evitando cualquier problema de orden de dependencia entre dominios (varias tablas de dominios
 * "tempranos" tienen FKs hacia tablas de dominios "tardíos" — por ejemplo `customer_identity_documents`
 * → `evidence_documents` — así que las relaciones no se pueden repartir de forma segura por
 * dominio sin arriesgar un `CREATE TABLE` fallido por FK a una tabla que aún no existe).
 *
 * Split verificado programáticamente contra el archivo original: las 86 tablas de `TABLES` se
 * repartieron exactamente una vez entre las 10 partes (sin duplicados, sin faltantes), y las 244
 * foreign keys / 136 índices / 5 check constraints se preservaron sin cambios en
 * `schema-relationships`. Ver `docs/architecture/migration-split-verification.md` para el detalle
 * exacto de la verificación.
 */
const TABLES: TableSpec[] = [
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
];

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const table of TABLES) {
      await queryInterface.createTable(table.tableName, buildColumns(table), { transaction });
    }
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const table of [...TABLES].reverse()) {
      await queryInterface.dropTable(table.tableName, { cascade: true, transaction });
    }
  });
}
