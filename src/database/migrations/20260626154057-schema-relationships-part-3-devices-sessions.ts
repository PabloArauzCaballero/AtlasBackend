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
 * pertenece al dominio **devices-sessions**. Corre después de las 10 migraciones `schema-part-*`
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
    table: 'devices',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'devices',
    column: 'global_device_fingerprint_id',
    targetTable: 'global_device_fingerprints',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_device_links',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_device_links',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_device_links',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_device_links',
    column: 'first_seen_session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_device_links',
    column: 'last_seen_session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'device_snapshots',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'device_snapshots',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'device_snapshots',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'device_snapshots',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'device_risk_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'device_risk_events',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'sim_observations',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'sim_observations',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'sim_observations',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'sim_observations',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_sessions',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_sessions',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_sessions',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'auth_events',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'auth_events',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'auth_events',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'auth_events',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'ip_reputation_observations',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'ip_reputation_observations',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'ip_reputation_observations',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'ip_reputation_observations',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'ip_reputation_observations',
    column: 'provider_request_id',
    targetTable: 'data_provider_requests',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_action_logs',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_action_logs',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_action_logs',
    column: 'session_id',
    targetTable: 'customer_sessions',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_action_logs',
    column: 'device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_activity_summaries',
    column: 'customer_id',
    targetTable: 'customers',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_activity_summaries',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'customer_activity_summaries',
    column: 'first_device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_activity_summaries',
    column: 'usual_device_id',
    targetTable: 'devices',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'customer_activity_summaries',
    column: 'last_risk_assessment_id',
    targetTable: 'risk_assessment_results',
    targetColumn: '_id',
    allowNull: true,
  },
];

const CHECK_CONSTRAINTS: CheckConstraintSpec[] = [];

const INDEXES: IndexSpec[] = [
  {
    table: 'devices',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'customer_device_links',
    fields: ['_tenant_id'],
    where: '_deleted = false',
    unique: false,
  },
  {
    table: 'device_snapshots',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'device_risk_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'sim_observations',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_sessions',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'auth_events',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'ip_reputation_observations',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_action_logs',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'customer_activity_summaries',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'global_device_fingerprints',
    fields: ['device_fingerprint'],
    where: null,
    unique: true,
  },
  {
    table: 'devices',
    fields: ['_tenant_id', 'device_fingerprint'],
    where: '_deleted = false',
    unique: true,
  },
  {
    table: 'devices',
    fields: ['global_device_fingerprint_id'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'customer_device_links',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "last_seen_at" DESC',
  },
  {
    table: 'device_snapshots',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"device_id", "captured_at" DESC',
  },
  {
    table: 'customer_sessions',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "started_at" DESC',
  },
  {
    table: 'auth_events',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"customer_id", "occurred_at" DESC',
  },
  {
    table: 'ip_reputation_observations',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"ip_address", "captured_at" DESC',
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
