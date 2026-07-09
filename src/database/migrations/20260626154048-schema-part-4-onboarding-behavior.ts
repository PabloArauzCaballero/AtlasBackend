import { QueryInterface } from 'sequelize';
import { buildColumns, TableSpec } from '../migration-support/atlas-schema-builder.util.js';

/**
 * ATLAS-P11-T09: parte 5/10 del split de la migración inicial monolítica
 * (`20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts`, 12,554 líneas,
 * eliminada por este patch). Dominio: **onboarding-behavior** (7 tablas).
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
    className: 'OnboardingFlow',
    tableName: 'onboarding_flows',
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
        name: 'flow_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'started_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'completed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'abandoned_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'completion_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'total_duration_seconds',
        spec: {
          kind: 'INTEGER',
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
    className: 'OnboardingStepEvent',
    tableName: 'onboarding_step_events',
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
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'step_code',
        spec: {
          kind: 'STRING',
          length: 100,
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
        name: 'started_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'ended_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'duration_ms',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'error_count',
        spec: {
          kind: 'INTEGER',
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
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'FormFieldInteractionEvent',
    tableName: 'form_field_interaction_events',
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
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'field_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'interaction_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'used_copy_paste',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'correction_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'focus_duration_ms',
        spec: {
          kind: 'INTEGER',
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
    className: 'PermissionEvent',
    tableName: 'permission_events',
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
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'permission_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'requested_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'granted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'responded_at',
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
    className: 'OnboardingBehaviorSummary',
    tableName: 'onboarding_behavior_summaries',
    stereotypes: ['append-only', 'derived'],
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
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'completion_time_seconds',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'inter_screen_timing_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'form_error_rate',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'ci_copy_paste_detected',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'abandonment_count_prior',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'permission_grant_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'behavior_cluster_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'bot_likelihood_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'computation_version',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'computed_at',
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
    className: 'OnDeviceComputationRun',
    tableName: 'on_device_computation_runs',
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
        name: 'customer_id',
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
        name: 'session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'onboarding_flow_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'consent_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'algorithm_code',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'algorithm_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'computation_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'raw_contacts_stored',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'raw_sms_stored',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'integrity_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'computed_at_device',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'received_at_server',
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
    className: 'OnDeviceMetricValue',
    tableName: 'on_device_metric_values',
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
        name: 'computation_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'metric_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'value_text',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'value_number',
        spec: {
          kind: 'DECIMAL',
          precision: 18,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'value_boolean',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'value_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
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
