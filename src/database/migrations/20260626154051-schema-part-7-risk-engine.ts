import { QueryInterface } from 'sequelize';
import { buildColumns, TableSpec } from '../migration-support/atlas-schema-builder.util.js';

/**
 * ATLAS-P11-T09: parte 8/10 del split de la migración inicial monolítica
 * (`20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts`, 12,554 líneas,
 * eliminada por este patch). Dominio: **risk-engine** (9 tablas).
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
    className: 'RiskModelVersion',
    tableName: 'risk_model_versions',
    stereotypes: ['versioned', 'catalog', 'platform-shared'],
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
        name: 'model_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'version_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'model_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'assessment_type',
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
        name: 'effective_from',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'effective_until',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'approved_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'approved_at',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'artifact_url',
        spec: {
          kind: 'TEXT',
          allowNull: true,
        },
      },
      {
        name: 'artifact_hash',
        spec: {
          kind: 'STRING',
          length: 128,
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
    className: 'RiskRulesetVersion',
    tableName: 'risk_ruleset_versions',
    stereotypes: ['versioned', 'catalog', 'platform-shared'],
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
        name: 'ruleset_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'version_code',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'assessment_type',
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
        name: 'effective_from',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'effective_until',
        spec: {
          kind: 'DATE',
          allowNull: true,
        },
      },
      {
        name: 'approved_by_platform_user_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'approved_at',
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
    className: 'RiskPolicyRule',
    tableName: 'risk_policy_rules',
    stereotypes: ['versioned', 'catalog', 'platform-shared'],
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
        name: 'ruleset_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
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
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'rule_type',
        spec: {
          kind: 'STRING',
          length: 60,
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
        name: 'action_code',
        spec: {
          kind: 'STRING',
          length: 80,
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
        name: 'is_hard_stop',
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
    ],
  },
  {
    className: 'RiskAssessmentRun',
    tableName: 'risk_assessment_runs',
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
        name: 'subject_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'subject_id',
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
        name: 'onboarding_flow_id',
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
        name: 'feature_snapshot_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_model_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_ruleset_version_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'assessment_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'trigger_source',
        spec: {
          kind: 'STRING',
          length: 80,
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
        name: 'run_status',
        spec: {
          kind: 'STRING',
          length: 40,
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
        name: 'latency_ms',
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
    className: 'RiskAssessmentContext',
    tableName: 'risk_assessment_contexts',
    stereotypes: ['snapshot'],
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
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'context_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'external_entity_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'external_entity_id',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'merchant_id_snapshot',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'merchant_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'merchant_risk_band_snapshot',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'merchant_default_rate_snapshot',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'store_id_snapshot',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'product_category_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'product_subcategory_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'basket_item_count_snapshot',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'basket_duplicate_item_count_snapshot',
        spec: {
          kind: 'INTEGER',
          allowNull: true,
        },
      },
      {
        name: 'basket_anomaly_score',
        spec: {
          kind: 'DECIMAL',
          precision: 5,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'transaction_amount_snapshot',
        spec: {
          kind: 'DECIMAL',
          precision: 14,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'currency_code',
        spec: {
          kind: 'STRING',
          length: 3,
          allowNull: true,
        },
      },
      {
        name: 'purchase_to_declared_income_ratio',
        spec: {
          kind: 'DECIMAL',
          precision: 10,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'down_payment_required_pct_snapshot',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 4,
          allowNull: true,
        },
      },
      {
        name: 'down_payment_behavior_snapshot',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'store_to_home_distance_meters',
        spec: {
          kind: 'DECIMAL',
          precision: 12,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'context_payload_hash',
        spec: {
          kind: 'STRING',
          length: 128,
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
    className: 'RiskRuleFired',
    tableName: 'risk_rules_fired',
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
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'risk_policy_rule_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'rule_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'ruleset_version_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'input_values_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'output_action',
        spec: {
          kind: 'STRING',
          length: 80,
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
        name: 'is_hard_stop',
        spec: {
          kind: 'BOOLEAN',
          allowNull: true,
        },
      },
      {
        name: 'fired_at',
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
    className: 'RiskFeatureContribution',
    tableName: 'risk_feature_contributions',
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
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'feature_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'raw_value_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'bin_or_attribute',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'woe_value',
        spec: {
          kind: 'DECIMAL',
          precision: 12,
          scale: 6,
          allowNull: true,
        },
      },
      {
        name: 'score_points',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
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
        name: '_created_at',
        spec: {
          kind: 'DATE',
          allowNull: false,
        },
      },
    ],
  },
  {
    className: 'RiskAssessmentResult',
    tableName: 'risk_assessment_results',
    stereotypes: ['snapshot'],
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
        name: 'risk_assessment_run_id',
        spec: {
          kind: 'BIGINT',
          allowNull: true,
        },
      },
      {
        name: 'subject_type',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'subject_id',
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
        name: 'onboarding_flow_id',
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
        name: 'assessment_type',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'recommended_action',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'risk_level',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'score_total',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'fraud_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'identity_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'device_risk_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'behavior_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'contactability_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'consistency_score',
        spec: {
          kind: 'DECIMAL',
          precision: 8,
          scale: 2,
          allowNull: true,
        },
      },
      {
        name: 'reason_codes_json',
        spec: {
          kind: 'JSONB',
          allowNull: true,
        },
      },
      {
        name: 'model_version_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'ruleset_version_code_snapshot',
        spec: {
          kind: 'STRING',
          length: 80,
          allowNull: true,
        },
      },
      {
        name: 'feature_snapshot_id',
        spec: {
          kind: 'BIGINT',
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
        name: 'decided_at',
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
    className: 'RiskSignalSeed',
    tableName: 'risk_signal_seeds',
    stereotypes: ['catalog', 'platform-shared', 'roadmap'],
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
        name: 'signal_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'signal_name',
        spec: {
          kind: 'STRING',
          length: 180,
          allowNull: true,
        },
      },
      {
        name: 'signal_type',
        spec: {
          kind: 'STRING',
          length: 60,
          allowNull: true,
        },
      },
      {
        name: 'source_entity',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'target_definition_code',
        spec: {
          kind: 'STRING',
          length: 120,
          allowNull: true,
        },
      },
      {
        name: 'risk_dimension',
        spec: {
          kind: 'STRING',
          length: 60,
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
        name: 'priority',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'expected_direction',
        spec: {
          kind: 'STRING',
          length: 40,
          allowNull: true,
        },
      },
      {
        name: 'example_value_json',
        spec: {
          kind: 'JSONB',
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
