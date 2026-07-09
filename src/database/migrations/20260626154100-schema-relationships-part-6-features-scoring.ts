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
 * pertenece al dominio **features-scoring**. Corre después de las 10 migraciones `schema-part-*`
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
];

const CHECK_CONSTRAINTS: CheckConstraintSpec[] = [];

const INDEXES: IndexSpec[] = [
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
    table: 'feature_definitions',
    fields: ['feature_code'],
    where: null,
    unique: true,
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
