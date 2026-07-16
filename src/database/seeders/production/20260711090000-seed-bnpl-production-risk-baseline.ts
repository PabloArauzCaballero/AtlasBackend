import { QueryInterface, QueryTypes, Transaction } from 'sequelize';

/**
 * Baseline BNPL para catálogos de riesgo.
 *
 * Estos registros describen señales mínimas para underwriting responsable. No son un modelo
 * calibrado ni autorizan decisiones automáticas: los umbrales deben validarse con Riesgo,
 * Cumplimiento y datos históricos bolivianos antes de activar originación en producción.
 * Las reglas de capacidad incompleta y sobreendeudamiento deliberadamente envían a revisión.
 */

const CREATED_AT = new Date('2026-07-11T00:00:00.000Z');

type Feature = {
  code: string;
  name: string;
  family: string;
  dimension: string;
  dataType: 'number' | 'boolean';
};

const FEATURES: Feature[] = [
  {
    code: 'feat_verified_net_income_monthly_bob',
    name: 'Ingreso neto mensual verificado (BOB)',
    family: 'affordability',
    dimension: 'capacity',
    dataType: 'number',
  },
  {
    code: 'feat_essential_expenses_monthly_bob',
    name: 'Gastos esenciales mensuales declarados/verificados (BOB)',
    family: 'affordability',
    dimension: 'capacity',
    dataType: 'number',
  },
  {
    code: 'feat_existing_debt_service_monthly_bob',
    name: 'Servicio mensual de deuda existente (BOB)',
    family: 'affordability',
    dimension: 'capacity',
    dataType: 'number',
  },
  {
    code: 'feat_bnpl_active_loan_count',
    name: 'Operaciones BNPL activas conocidas',
    family: 'exposure',
    dimension: 'indebtedness',
    dataType: 'number',
  },
  {
    code: 'feat_bnpl_provider_count_90d',
    name: 'Proveedores BNPL observados en 90 días',
    family: 'exposure',
    dimension: 'indebtedness',
    dataType: 'number',
  },
  {
    code: 'feat_bnpl_monthly_installment_bob',
    name: 'Nueva carga mensual BNPL propuesta (BOB)',
    family: 'affordability',
    dimension: 'capacity',
    dataType: 'number',
  },
  {
    code: 'feat_residual_income_after_credit_bob',
    name: 'Ingreso residual después de gastos y deudas (BOB)',
    family: 'affordability',
    dimension: 'capacity',
    dataType: 'number',
  },
  {
    code: 'feat_total_debt_service_ratio',
    name: 'Cuota total de deuda sobre ingreso neto',
    family: 'affordability',
    dimension: 'capacity',
    dataType: 'number',
  },
  {
    code: 'feat_recent_payment_failures_30d',
    name: 'Intentos de cobro fallidos en 30 días',
    family: 'repayment',
    dimension: 'financial_difficulty',
    dataType: 'number',
  },
  {
    code: 'feat_financial_hardship_active',
    name: 'Dificultad financiera o reprogramación activa',
    family: 'forbearance',
    dimension: 'financial_difficulty',
    dataType: 'boolean',
  },
  {
    code: 'feat_refund_dispute_open',
    name: 'Devolución o disputa de compra abierta',
    family: 'consumer_protection',
    dimension: 'servicing',
    dataType: 'boolean',
  },
  {
    code: 'feat_merchant_refund_rate_90d',
    name: 'Tasa de devoluciones del comercio en 90 días',
    family: 'merchant',
    dimension: 'merchant_risk',
    dataType: 'number',
  },
];

const RULES = [
  {
    code: 'review_incomplete_affordability_evidence',
    name: 'Revisar si faltan datos verificables de capacidad de pago',
    dimension: 'capacity',
    severity: 'high',
    action: 'MANUAL_REVIEW',
    reason: 'AFFORDABILITY_EVIDENCE_INCOMPLETE',
    expression: {
      any: [
        { field: 'feat_verified_net_income_monthly_bob', missing: true },
        { field: 'feat_essential_expenses_monthly_bob', missing: true },
        { field: 'feat_existing_debt_service_monthly_bob', missing: true },
        { field: 'feat_bnpl_monthly_installment_bob', missing: true },
      ],
    },
  },
  {
    code: 'block_non_positive_residual_income',
    name: 'Bloquear si la nueva cuota deja ingreso residual no positivo',
    dimension: 'capacity',
    severity: 'critical',
    action: 'BLOCK',
    reason: 'INSUFFICIENT_RESIDUAL_INCOME',
    expression: { all: [{ field: 'feat_residual_income_after_credit_bob', lte: 0 }] },
  },
  {
    code: 'review_high_total_debt_service',
    name: 'Revisar carga total de deuda elevada',
    dimension: 'capacity',
    severity: 'high',
    action: 'MANUAL_REVIEW',
    reason: 'HIGH_TOTAL_DEBT_SERVICE',
    expression: { all: [{ field: 'feat_total_debt_service_ratio', gte: 0.4 }] },
  },
  {
    code: 'review_bnpl_loan_stacking',
    name: 'Revisar acumulación de operaciones BNPL simultáneas',
    dimension: 'indebtedness',
    severity: 'high',
    action: 'MANUAL_REVIEW',
    reason: 'BNPL_LOAN_STACKING',
    expression: {
      any: [
        { field: 'feat_bnpl_active_loan_count', gte: 3 },
        { field: 'feat_bnpl_provider_count_90d', gte: 2 },
      ],
    },
  },
  {
    code: 'block_new_credit_during_financial_hardship',
    name: 'No originar crédito nuevo durante dificultad financiera activa',
    dimension: 'financial_difficulty',
    severity: 'critical',
    action: 'BLOCK',
    reason: 'ACTIVE_FINANCIAL_HARDSHIP',
    expression: { all: [{ field: 'feat_financial_hardship_active', equals: true }] },
  },
  {
    code: 'review_repeated_payment_failures',
    name: 'Revisar intentos de cobro fallidos recientes',
    dimension: 'financial_difficulty',
    severity: 'high',
    action: 'MANUAL_REVIEW',
    reason: 'REPEATED_PAYMENT_FAILURES',
    expression: { all: [{ field: 'feat_recent_payment_failures_30d', gte: 2 }] },
  },
  {
    code: 'hold_collection_during_open_dispute',
    name: 'Suspender gestión de cobro sobre una compra disputada',
    dimension: 'servicing',
    severity: 'critical',
    action: 'HOLD_COLLECTION',
    reason: 'OPEN_PURCHASE_DISPUTE',
    expression: { all: [{ field: 'feat_refund_dispute_open', equals: true }] },
  },
] as const;

async function getRulesetId(queryInterface: QueryInterface, transaction: Transaction): Promise<number> {
  const rows = await queryInterface.sequelize.query<{ _id: string }>(
    `SELECT _id FROM risk_ruleset_versions WHERE ruleset_code = 'atlas_mvp_onboarding_ruleset' ORDER BY effective_from DESC NULLS LAST, _id DESC LIMIT 1`,
    { type: QueryTypes.SELECT, transaction },
  );
  if (!rows[0]) throw new Error('BNPL baseline requiere el ruleset atlas_mvp_onboarding_ruleset. Ejecute los seeders en orden.');
  return Number(rows[0]._id);
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    const rulesetId = await getRulesetId(queryInterface, transaction);
    for (const feature of FEATURES) {
      await queryInterface.sequelize.query(
        `INSERT INTO feature_definitions
          (feature_code, feature_name, feature_family, risk_dimension, data_type, availability_tier, build_phase,
           data_classification_code, calculation_kind, default_missing_strategy, is_model_input, is_policy_rule_input,
           is_sensitive, allowed_for_credit_decision, allowed_for_fraud_decision, legal_review_status,
           fairness_review_required, retention_policy_id, owner_team, is_active, _created_at, _updated_at)
         VALUES (:code, :name, :family, :dimension, :dataType, 'production_baseline', 'MVP', 'RISK_SENSITIVE',
           'deterministic_or_verified_source', 'manual_review_if_missing', false, true, true, true, false,
           'requires_local_compliance_validation', false, 102, 'risk', true, :createdAt, :createdAt)
         ON CONFLICT (feature_code) DO UPDATE SET
           feature_name = EXCLUDED.feature_name, feature_family = EXCLUDED.feature_family,
           risk_dimension = EXCLUDED.risk_dimension, data_type = EXCLUDED.data_type,
           is_policy_rule_input = true, is_active = true, _updated_at = EXCLUDED._updated_at;`,
        { replacements: { ...feature, createdAt: CREATED_AT }, transaction },
      );
    }
    for (const rule of RULES) {
      await queryInterface.sequelize.query(
        `WITH updated AS (
           UPDATE risk_policy_rules SET
             ruleset_version_id = :rulesetId, rule_name = :name, risk_dimension = :dimension,
             rule_type = 'bnpl_responsible_lending', severity = :severity,
             expression_json = CAST(:expression AS jsonb), action_code = :action,
             reason_code = :reason, is_hard_stop = :hardStop
           WHERE rule_code = :code
           RETURNING _id
         )
         INSERT INTO risk_policy_rules
          (ruleset_version_id, rule_code, rule_name, risk_dimension, rule_type, severity, expression_json,
           action_code, reason_code, is_hard_stop, _created_at)
         SELECT :rulesetId, :code, :name, :dimension, 'bnpl_responsible_lending', :severity,
           CAST(:expression AS jsonb), :action, :reason, :hardStop, :createdAt
         WHERE NOT EXISTS (SELECT 1 FROM updated);`,
        {
          replacements: {
            ...rule,
            rulesetId,
            expression: JSON.stringify(rule.expression),
            hardStop: rule.action === 'BLOCK',
            createdAt: CREATED_AT,
          },
          transaction,
        },
      );
    }
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(`DELETE FROM risk_policy_rules WHERE rule_code IN (:codes)`, {
      replacements: { codes: RULES.map((rule) => rule.code) },
      transaction,
    });
    await queryInterface.sequelize.query(`DELETE FROM feature_definitions WHERE feature_code IN (:codes)`, {
      replacements: { codes: FEATURES.map((feature) => feature.code) },
      transaction,
    });
  });
}
