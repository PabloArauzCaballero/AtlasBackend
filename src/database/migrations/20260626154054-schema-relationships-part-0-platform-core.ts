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
 * pertenece al dominio **platform-core**. Corre después de las 10 migraciones `schema-part-*`
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
];

const CHECK_CONSTRAINTS: CheckConstraintSpec[] = [
  {
    table: 'data_provider_responses',
    name: 'ck_data_provider_response_payload_strategy',
    expression:
      "(\n      payload_storage_strategy IS NULL\n      OR (payload_storage_strategy = 'inline_full' AND response_payload_json IS NOT NULL)\n      OR (payload_storage_strategy = 'inline_redacted' AND redacted_payload_json IS NOT NULL)\n      OR (payload_storage_strategy = 's3_raw' AND raw_payload_s3_key IS NOT NULL)\n      OR (payload_storage_strategy = 'hashed_only' AND response_payload_json IS NULL AND redacted_payload_json IS NULL AND raw_payload_s3_key IS NULL)\n    )",
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
