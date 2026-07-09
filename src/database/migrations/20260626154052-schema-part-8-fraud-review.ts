import { QueryInterface } from 'sequelize';
import { buildColumns, TableSpec } from '../migration-support/atlas-schema-builder.util.js';

/**
 * ATLAS-P11-T09: parte 9/10 del split de la migración inicial monolítica
 * (`20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts`, 12,554 líneas,
 * eliminada por este patch). Dominio: **fraud-review** (6 tablas).
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
    className: 'ManualReviewCase',
    tableName: 'manual_review_cases',
    stereotypes: ['case'],
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
        name: 'case_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'fraud_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'case_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'priority',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'assigned_to_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'opened_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'closed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'resolution',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'notes',
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
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'ManualReviewEvent',
    tableName: 'manual_review_events',
    stereotypes: ['append-only'],
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
        name: 'manual_review_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_type',
        spec: {
          kind: 'STRING',
          length: 60,
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
        name: 'happened_at',
        spec: {
          kind: 'DATE',
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
        name: 'notes',
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
    className: 'FraudCase',
    tableName: 'fraud_cases',
    stereotypes: ['case'],
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
        name: 'case_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'primary_device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'escalated_from_review_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'case_status',
        spec: {
          kind: 'STRING',
          length: 40,
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
        name: 'pattern_detected',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'linked_customers_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'linked_sessions_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'linked_devices_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'assigned_to_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'opened_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'closed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'resolution',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'notes',
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
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'FraudCaseEvent',
    tableName: 'fraud_case_events',
    stereotypes: ['append-only'],
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
        name: 'fraud_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_type',
        spec: {
          kind: 'STRING',
          length: 60,
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
        name: 'happened_at',
        spec: {
          kind: 'DATE',
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
        name: 'notes',
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
    className: 'WatchlistEntry',
    tableName: 'watchlist_entries',
    stereotypes: ['core', 'privacy'],
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
        name: 'scope',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'country_code',
        spec: {
          kind: 'STRING',
          length: 3,
          allowNull: true,
        },
      },
      {
        name: 'entity_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'entity_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'entity_last_4',
        spec: {
          kind: 'STRING',
          length: 4,
          allowNull: true,
        },
      },
      {
        name: 'reason_code',
        spec: {
          kind: 'STRING',
          length: 100,
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
        name: 'status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'source_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'created_by_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'created_by_internal_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'created_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'expires_at',
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
      {
        name: '_updated_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: '_deleted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
    ],
  },
  {
    className: 'WatchlistMatch',
    tableName: 'watchlist_matches',
    stereotypes: ['append-only', 'privacy'],
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
        name: 'watchlist_entry_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'matched_entity_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'matched_value_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'match_method',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'match_confidence',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'opened_review_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'opened_fraud_case_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'matched_at',
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
