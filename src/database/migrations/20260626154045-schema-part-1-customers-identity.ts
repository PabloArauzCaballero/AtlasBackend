import { QueryInterface } from 'sequelize';
import { buildColumns, TableSpec } from '../migration-support/atlas-schema-builder.util.js';

/**
 * ATLAS-P11-T09: parte 2/10 del split de la migración inicial monolítica
 * (`20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts`, 12,554 líneas,
 * eliminada por este patch). Dominio: **customers-identity** (11 tablas).
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
