import { QueryInterface } from 'sequelize';
import { buildColumns, TableSpec } from '../migration-support/atlas-schema-builder.util.js';

/**
 * ATLAS-P11-T09: parte 4/10 del split de la migración inicial monolítica
 * (`20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts`, 12,554 líneas,
 * eliminada por este patch). Dominio: **devices-sessions** (11 tablas).
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
    className: 'GlobalDeviceFingerprint',
    tableName: 'global_device_fingerprints',
    stereotypes: ['platform-shared'],
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
        name: 'device_fingerprint',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'fingerprint_version',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'global_first_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'global_last_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'global_reuse_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'global_risk_status',
        spec: {
          kind: 'STRING',
          length: 40,
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
    className: 'Device',
    tableName: 'devices',
    stereotypes: ['core'],
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
        name: 'global_device_fingerprint_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'device_fingerprint',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'fingerprint_version',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'first_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'last_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'tenant_reuse_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'risk_status',
        spec: {
          kind: 'STRING',
          length: 40,
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
    className: 'CustomerDeviceLink',
    tableName: 'customer_device_links',
    stereotypes: ['core'],
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
        name: 'link_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'is_primary_device',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'trust_level',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'first_seen_session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'last_seen_session_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'first_seen_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'last_seen_at',
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
    className: 'DeviceSnapshot',
    tableName: 'device_snapshots',
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
        name: 'device_id',
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
        name: 'brand',
        spec: {
          kind: 'STRING',
          length: 100,
          allowNull: true,
        },
      },
      {
        name: 'model',
        spec: {
          kind: 'STRING',
          length: 160,
          allowNull: true,
        },
      },
      {
        name: 'os_family',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'os_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'app_version',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'device_release_year',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'device_age_months',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'device_tier_snapshot',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'estimated_device_value_bs_snapshot',
        spec: {
          kind: 'DECIMAL',
          precision: 14,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'is_rooted',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_emulator',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'vpn_detected',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'screen_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'captured_at',
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
    className: 'DeviceRiskEvent',
    tableName: 'device_risk_events',
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
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'previous_risk_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'new_risk_status',
        spec: {
          kind: 'STRING',
          length: 40,
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
        name: 'supporting_evidence_json',
        spec: {
          kind: 'JSONB',
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
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'SimObservation',
    tableName: 'sim_observations',
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
        name: 'device_id',
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
        name: 'phone_number_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'phone_last_4',
        spec: {
          kind: 'STRING',
          length: 4,
          allowNull: true,
        },
      },
      {
        name: 'carrier_name',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'sim_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'sim_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'phone_line_tenure_months',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'last_sim_swap_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'sim_swap_days_since',
        spec: {
          kind: 'INTEGER',
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
        name: 'confidence_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'captured_at',
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
    className: 'CustomerSession',
    tableName: 'customer_sessions',
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
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'session_token_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'channel',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'auth_method',
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
        name: 'gps_lat',
        spec: {
          kind: 'DECIMAL',
          precision: 10,
          scale: 7,
          allowNull: true,
        },
      },
      {
        name: 'gps_lng',
        spec: {
          kind: 'DECIMAL',
          precision: 10,
          scale: 7,
          allowNull: true,
        },
      },
      {
        name: 'gps_accuracy_meters',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'session_status',
        spec: {
          kind: 'STRING',
          length: 40,
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
    className: 'AuthEvent',
    tableName: 'auth_events',
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
        name: 'device_id',
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
        name: 'login_successful',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'failure_reason_code',
        spec: {
          kind: 'STRING',
          length: 80,
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
        name: 'ip_address',
        spec: {
          kind: 'INET',
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
    className: 'IpReputationObservation',
    tableName: 'ip_reputation_observations',
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
        name: 'session_id',
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
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'provider_request_id',
        spec: {
          kind: 'BIGINT',
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
        name: 'is_vpn',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_proxy',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'is_tor',
        spec: {
          kind: 'BOOLEAN',
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
        name: 'city',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'reputation_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'captured_at',
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
    className: 'CustomerActionLog',
    tableName: 'customer_action_logs',
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
        name: 'device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'event_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'screen_name',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'action_payload_json',
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
    className: 'CustomerActivitySummary',
    tableName: 'customer_activity_summaries',
    stereotypes: ['projection'],
    columns: [
      {
        name: 'customer_id',
        spec: {
          kind: 'BIGINT',
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
        name: 'first_session_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'last_session_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'first_device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'usual_device_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'total_sessions',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'total_devices_seen',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'failed_login_count_7d',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'device_change_count_30d',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'suspicious_ip_count_30d',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'current_risk_level',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'current_trust_tier',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'last_risk_assessment_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'last_risk_assessed_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'watchlist_hit_count_lifetime',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'fraud_case_count_lifetime',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'open_manual_review_count',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'recomputed_at',
        spec: {
          kind: 'DATE',
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
