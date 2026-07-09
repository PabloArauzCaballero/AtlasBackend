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
 * pertenece al dominio **audit-quality**. Corre después de las 10 migraciones `schema-part-*`
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
    table: 'data_change_logs',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: false,
  },
  {
    table: 'data_change_logs',
    column: 'changed_by_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_change_logs',
    column: 'changed_by_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'operational_audit_logs',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'operational_audit_logs',
    column: 'actor_internal_user_id',
    targetTable: 'internal_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'operational_audit_logs',
    column: 'actor_platform_user_id',
    targetTable: 'platform_users',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_quality_issues',
    column: '_tenant_id',
    targetTable: 'tenants',
    targetColumn: '_id',
    allowNull: true,
  },
  {
    table: 'data_quality_issues',
    column: 'quality_rule_id',
    targetTable: 'data_quality_rules',
    targetColumn: '_id',
    allowNull: true,
  },
];

const CHECK_CONSTRAINTS: CheckConstraintSpec[] = [];

const INDEXES: IndexSpec[] = [
  {
    table: 'data_change_logs',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'operational_audit_logs',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'data_quality_issues',
    fields: ['_tenant_id'],
    where: null,
    unique: false,
  },
  {
    table: 'data_quality_rules',
    fields: ['rule_code'],
    where: null,
    unique: true,
  },
  {
    table: 'data_change_logs',
    fields: ['table_name', 'record_id'],
    where: null,
    unique: false,
    using: null,
    rawColumns: null,
  },
  {
    table: 'data_change_logs',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"_tenant_id", "changed_at" DESC',
  },
  {
    table: 'operational_audit_logs',
    fields: [],
    where: null,
    unique: false,
    using: null,
    rawColumns: '"actor_internal_user_id", "occurred_at" DESC',
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
