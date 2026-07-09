import { QueryInterface } from 'sequelize';
import { buildColumns, TableSpec } from '../migration-support/atlas-schema-builder.util.js';

/**
 * ATLAS-P11-T09: parte 10/10 del split de la migración inicial monolítica
 * (`20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts`, 12,554 líneas,
 * eliminada por este patch). Dominio: **audit-quality** (5 tablas).
 *
 * Esta migración SOLO crea tablas (`CREATE TABLE`) — sin foreign keys, índices ni check
 * constraints, exactamente como hacía la migración original en su primera fase (`up()` original:
 * loop de `createTable` seguido de `addForeignKeys`/`addChecks`/`createIndexes` como fases
 * separadas). Esa misma separación se preserva aquí a nivel de archivo: las 10 migraciones de
 * "parte" (`schema-part-*`) crean únicamente tablas; `schema-relationships` (que corre después
 * de las 10) agrega TODAS las foreign keys, checks e índices de las 86 tablas en un solo paso,
 * evitando cualquier problema de orden de dependencia entre dominios (varias tablas de dominios
 * "tempranos" tienen FKs hacia tablas de dominios "tardíos" — por ejemplo `customer_identity_documents`
 * → `evidence_documents` — así que las relaciones no se pueden repartir de forma segura por
 * dominio sin arriesgar un `CREATE TABLE` fallido por FK a una tabla que aún no existe).
 *
 * Split verificado programáticamente contra el archivo original: las 86 tablas de `TABLES` se
 * repartieron exactamente una vez entre las 10 partes (sin duplicados, sin faltantes), y las 244
 * foreign keys / 136 índices / 5 check constraints se preservaron sin cambios en
 * `schema-relationships`. Ver `docs/architecture/migration-split-verification.md` para el detalle
 * exacto de la verificación.
 */
const TABLES: TableSpec[] = [
  {
    className: 'DataChangeLog',
    tableName: 'data_change_logs',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: false,
        },
      },
      {
        name: 'table_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'record_id',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'change_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'changed_by_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'changed_by_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'changed_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'old_values_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'new_values_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'change_reason',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'changed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'OperationalAuditLog',
    tableName: 'operational_audit_logs',
    stereotypes: ['append-only', 'event'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'actor_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'actor_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'actor_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'action_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_type',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_id',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'ip_address',
        spec: {
          kind: 'INET',
          allowNull: true,
        },
      },
      {
        name: 'user_agent',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'occurred_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'DataQualityRule',
    tableName: 'data_quality_rules',
    stereotypes: ['catalog', 'platform-shared', 'quality'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'rule_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'rule_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'target_table',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_field',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'severity',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'expression_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'expected_action',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'build_phase',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'is_active',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'DataQualityIssue',
    tableName: 'data_quality_issues',
    stereotypes: ['append-only', 'quality'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: '_tenant_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'quality_rule_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'target_table',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_record_id',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'issue_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'detected_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'resolved_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'resolution_notes',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'SchemaConstraintNote',
    tableName: 'schema_constraint_notes',
    stereotypes: ['catalog', 'platform-shared', 'quality'],
    columns: [
      {
        name: '_id',
        spec: {
          kind: 'BIGINT',
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        name: 'table_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'constraint_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'constraint_expression',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'rationale',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'build_phase',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'is_required_for_mvp',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
    ],
  },
];

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const table of TABLES) {
      await queryInterface.createTable(table.tableName, buildColumns(table), { transaction });
    }
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const table of [...TABLES].reverse()) {
      await queryInterface.dropTable(table.tableName, { cascade: true, transaction });
    }
  });
}
