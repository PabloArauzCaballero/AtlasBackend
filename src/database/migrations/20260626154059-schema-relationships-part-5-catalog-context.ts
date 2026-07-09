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
 * pertenece al dominio **catalog-context**. Corre después de las 10 migraciones `schema-part-*`
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
];

const CHECK_CONSTRAINTS: CheckConstraintSpec[] = [];

const INDEXES: IndexSpec[] = [
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
