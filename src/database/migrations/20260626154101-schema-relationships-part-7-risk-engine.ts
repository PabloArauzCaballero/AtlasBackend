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
 * pertenece al dominio **risk-engine**. Corre después de las 10 migraciones `schema-part-*`
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
];

const CHECK_CONSTRAINTS: CheckConstraintSpec[] = [
  {
    table: 'risk_assessment_runs',
    name: 'ck_risk_assessment_subject_present',
    expression: 'customer_id IS NOT NULL OR session_id IS NOT NULL OR onboarding_flow_id IS NOT NULL OR device_id IS NOT NULL',
  },
];

const INDEXES: IndexSpec[] = [
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
    table: 'risk_signal_seeds',
    fields: ['signal_code'],
    where: null,
    unique: true,
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
