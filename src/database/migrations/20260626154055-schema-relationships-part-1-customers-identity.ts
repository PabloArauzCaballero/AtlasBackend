import { QueryInterface } from 'sequelize';
import {
  addForeignKeys,
  addChecks,
  createIndexes,
  indexName,
  shortenName,
  ForeignKeySpec,
  IndexSpec,
  CheckConstraintSpec,
} from '../migration-support/atlas-schema-builder.util.js';

/**
 * ATLAS-P11-T09: relaciones (foreign keys, check constraints, índices) cuya tabla de origen
 * pertenece al dominio **customers-identity**. Corre después de las 10 migraciones `schema-part-*`
 * (todas las tablas ya existen), por lo que puede referenciar foreign keys hacia tablas de
 * cualquier otro dominio sin problema de orden — ver la nota completa sobre por qué las
 * relaciones se separaron de la creación de tablas en
 * `docs/architecture/migration-split-verification.md`.
 *
 * Se reparte por dominio (igual que las tablas) en vez de vivir en un único archivo de
 * relaciones, para que cada migración siga siendo revisable en una sola pasada.
 */
const FOREIGN_KEYS: ForeignKeySpec[] = [
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
];

const CHECK_CONSTRAINTS: CheckConstraintSpec[] = [];

const INDEXES: IndexSpec[] = [
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
];

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await addForeignKeys(queryInterface, FOREIGN_KEYS);
  await addChecks(queryInterface, CHECK_CONSTRAINTS);
  await createIndexes(queryInterface, INDEXES);
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  for (const index of [...INDEXES].reverse()) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${indexName(index)}";`);
  }
  for (const constraint of [...CHECK_CONSTRAINTS].reverse()) {
    await queryInterface.sequelize.query(`ALTER TABLE "${constraint.table}" DROP CONSTRAINT IF EXISTS "${constraint.name}";`);
  }
  for (const fk of [...FOREIGN_KEYS].reverse()) {
    const name = shortenName(`fk_${fk.table}_${fk.column}`);
    await queryInterface.removeConstraint(fk.table, name);
  }
}
