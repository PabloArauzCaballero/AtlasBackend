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
 * pertenece al dominio **onboarding-behavior**. Corre después de las 10 migraciones `schema-part-*`
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
];

const CHECK_CONSTRAINTS: CheckConstraintSpec[] = [
  {
    table: 'on_device_computation_runs',
    name: 'ck_on_device_no_raw_contacts_or_sms',
    expression: '(raw_contacts_stored IS FALSE AND raw_sms_stored IS FALSE)',
  },
];

const INDEXES: IndexSpec[] = [
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
