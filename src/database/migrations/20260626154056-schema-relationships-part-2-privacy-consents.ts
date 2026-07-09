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
 * pertenece al dominio **privacy-consents**. Corre después de las 10 migraciones `schema-part-*`
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
];

const CHECK_CONSTRAINTS: CheckConstraintSpec[] = [
  {
    table: 'evidence_documents',
    name: 'ck_evidence_document_not_orphan',
    expression: 'customer_id IS NOT NULL OR uploaded_from_session_id IS NOT NULL',
  },
];

const INDEXES: IndexSpec[] = [
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
