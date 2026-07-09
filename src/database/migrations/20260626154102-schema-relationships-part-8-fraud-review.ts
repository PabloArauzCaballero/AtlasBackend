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
 * pertenece al dominio **fraud-review**. Corre después de las 10 migraciones `schema-part-*`
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
];

const CHECK_CONSTRAINTS: CheckConstraintSpec[] = [
  {
    table: 'watchlist_entries',
    name: 'ck_watchlist_entries_scope_consistency',
    expression:
      "(\n      (scope = 'global' AND _tenant_id IS NULL AND country_code IS NULL)\n      OR (scope = 'country' AND _tenant_id IS NULL AND country_code IS NOT NULL)\n      OR (scope = 'tenant' AND _tenant_id IS NOT NULL)\n      OR scope IS NULL\n    )",
  },
];

const INDEXES: IndexSpec[] = [
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
