import { QueryInterface } from 'sequelize';
import { buildColumns, TableSpec } from '../migration-support/atlas-schema-builder.util.js';

/**
 * ATLAS-P11-T09: parte 1/10 del split de la migración inicial monolítica
 * (`20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts`, 12,554 líneas,
 * eliminada por este patch). Dominio: **platform-core** (7 tablas).
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
    className: 'Tenant',
    tableName: 'tenants',
    stereotypes: ['platform-root'],
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
        name: 'tenant_code',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'legal_name',
        spec: {
          kind: 'STRING',
          length: 180,
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
        name: 'status',
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
    className: 'PlatformUser',
    tableName: 'platform_users',
    stereotypes: ['platform-root'],
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
        name: 'user_code',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'full_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'email',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'role_code',
        spec: {
          kind: 'STRING',
          length: 80,
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
    className: 'InternalUser',
    tableName: 'internal_users',
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
        name: 'user_code',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'full_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'email',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'role_code',
        spec: {
          kind: 'STRING',
          length: 80,
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
    className: 'RetentionPolicy',
    tableName: 'retention_policies',
    stereotypes: ['catalog', 'platform-shared'],
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
        name: 'policy_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'applies_to',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'retention_days',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'post_retention_action',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'legal_basis',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'description',
        spec: {
          kind: 'TEXT',
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
    className: 'DataProvider',
    tableName: 'data_providers',
    stereotypes: ['catalog', 'platform-shared'],
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
        name: 'provider_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'provider_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'provider_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'reliability_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'supports_retro_data',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'default_retention_policy_id',
        spec: {
          kind: 'BIGINT',
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
    className: 'DataProviderRequest',
    tableName: 'data_provider_requests',
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
        name: 'provider_id',
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
        name: 'risk_assessment_run_id',
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
        name: 'request_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'provider_request_ref',
        spec: {
          kind: 'STRING',
          length: 160,
          allowNull: true,
        },
      },
      {
        name: 'request_payload_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'idempotency_key',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'response_status',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'response_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'latency_ms',
        spec: {
          kind: 'INTEGER',
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
    className: 'DataProviderResponse',
    tableName: 'data_provider_responses',
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
        name: 'provider_request_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'payload_storage_strategy',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'response_payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'redacted_payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'raw_payload_s3_key',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'response_hash',
        spec: {
          kind: 'STRING',
          length: 128,
          allowNull: true,
        },
      },
      {
        name: 'normalized_payload_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'contains_sensitive_data',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'retention_policy_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'retention_until',
        spec: {
          kind: 'DATEONLY',
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
