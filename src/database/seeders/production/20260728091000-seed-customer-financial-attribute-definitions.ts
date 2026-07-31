/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define production para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface, Transaction } from 'sequelize';

/**
 * Catálogo de atributos económicos declarados por el cliente durante el onboarding (perfil PRODUCTION).
 *
 * `attribute_definitions` y `customer_attribute_values` estaban migradas desde el arranque del
 * proyecto y sin un solo uso en `src/modules/`: el modelo de datos para la información laboral,
 * económica y financiera existía, pero no había ni catálogo sembrado ni camino de escritura.
 *
 * Sin estas filas, `PUT /customer-onboarding/:customerId/financial-profile` falla explícitamente con
 * `ATTRIBUTE_CATALOG_NOT_SEEDED` — a propósito: guardar en silencio la mitad de los campos dejaría
 * al cliente creyendo que completó una sección que la regla de habilitación verá vacía.
 *
 * `allowed_for_credit_decision` y `is_sensitive` no son decorativos: el gobierno de datos del
 * proyecto los usa para decidir qué puede entrar en un modelo crediticio y qué exige protección
 * reforzada. El ingreso y los egresos declarados son insumo legítimo de la decisión de crédito;
 * el nombre del empleador NO lo es (riesgo de proxy discriminatorio), y por eso queda marcado
 * como no permitido para decisión crediticia aunque se recoja para verificación.
 *
 * Idempotente por `attribute_code` (índice natural del catálogo): reejecutar actualiza en vez de
 * duplicar, igual que el resto de seeders productivos del repositorio.
 */

const CREATED_AT = new Date('2026-07-28T00:00:00.000Z');

type AttributeSeed = {
  code: string;
  name: string;
  dataType: 'text' | 'number';
  riskDimension: string;
  isSensitive: boolean;
  allowedForCreditDecision: boolean;
};

const ATTRIBUTES: readonly AttributeSeed[] = [
  {
    code: 'employment_status',
    name: 'Situación laboral declarada',
    dataType: 'text',
    riskDimension: 'capacity',
    isSensitive: false,
    allowedForCreditDecision: true,
  },
  {
    code: 'employer_name',
    name: 'Empleador declarado',
    dataType: 'text',
    riskDimension: 'capacity',
    isSensitive: true,
    // Se recoge para verificación de ingresos, NO para el score: el empleador correlaciona con
    // sector, zona y origen social, y usarlo como variable de decisión es un proxy discriminatorio.
    allowedForCreditDecision: false,
  },
  {
    code: 'employment_seniority_months',
    name: 'Antigüedad laboral en meses',
    dataType: 'number',
    riskDimension: 'stability',
    isSensitive: false,
    allowedForCreditDecision: true,
  },
  {
    code: 'monthly_income_declared',
    name: 'Ingreso mensual declarado',
    dataType: 'number',
    riskDimension: 'capacity',
    isSensitive: true,
    allowedForCreditDecision: true,
  },
  {
    code: 'other_monthly_income',
    name: 'Otros ingresos mensuales declarados',
    dataType: 'number',
    riskDimension: 'capacity',
    isSensitive: true,
    allowedForCreditDecision: true,
  },
  {
    code: 'monthly_expenses_declared',
    name: 'Egresos mensuales declarados',
    dataType: 'number',
    riskDimension: 'capacity',
    isSensitive: true,
    allowedForCreditDecision: true,
  },
  {
    code: 'economic_activity_code',
    name: 'Actividad económica declarada',
    dataType: 'text',
    riskDimension: 'profile',
    isSensitive: false,
    allowedForCreditDecision: true,
  },
  {
    code: 'source_of_funds',
    name: 'Origen de fondos declarado',
    dataType: 'text',
    riskDimension: 'compliance',
    isSensitive: true,
    // Exigencia de prevención de lavado: se recoge y se conserva, pero la decisión crediticia no
    // se construye sobre él; su uso es de cumplimiento.
    allowedForCreditDecision: false,
  },
];

async function upsert(queryInterface: QueryInterface, attribute: AttributeSeed, transaction: Transaction): Promise<void> {
  await queryInterface.sequelize.query(
    `
    INSERT INTO attribute_definitions (
      attribute_code, attribute_name, entity_scope, data_type, risk_dimension, source_type,
      availability_stage, build_phase, data_classification_code, requires_consent, is_sensitive,
      is_model_candidate, allowed_for_credit_decision, allowed_for_fraud_decision,
      legal_review_status, fairness_review_required, is_active, owner_team, domain_code,
      review_status, _created_at, _updated_at
    )
    VALUES (
      :code, :name, 'customer', :dataType, :riskDimension, 'customer_declared',
      'onboarding', 'phase_1', :classification, true, :isSensitive,
      :allowedForCreditDecision, :allowedForCreditDecision, false,
      'pending_review', :fairnessReviewRequired, true, 'risk', 'customer_financial_profile',
      'approved', :createdAt, :createdAt
    )
    ON CONFLICT (attribute_code) DO UPDATE SET
      attribute_name = EXCLUDED.attribute_name,
      entity_scope = EXCLUDED.entity_scope,
      data_type = EXCLUDED.data_type,
      risk_dimension = EXCLUDED.risk_dimension,
      source_type = EXCLUDED.source_type,
      data_classification_code = EXCLUDED.data_classification_code,
      is_sensitive = EXCLUDED.is_sensitive,
      is_model_candidate = EXCLUDED.is_model_candidate,
      allowed_for_credit_decision = EXCLUDED.allowed_for_credit_decision,
      is_active = true,
      _updated_at = EXCLUDED._updated_at;
    `,
    {
      transaction,
      replacements: {
        code: attribute.code,
        name: attribute.name,
        dataType: attribute.dataType,
        riskDimension: attribute.riskDimension,
        classification: attribute.isSensitive ? 'sensitive_financial' : 'internal',
        isSensitive: attribute.isSensitive,
        allowedForCreditDecision: attribute.allowedForCreditDecision,
        fairnessReviewRequired: attribute.allowedForCreditDecision,
        createdAt: CREATED_AT,
      },
    },
  );
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // El catálogo se identifica por `attribute_code`; sin índice único el ON CONFLICT no aplica.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_attribute_definitions_code ON attribute_definitions (attribute_code);`,
      { transaction },
    );
    for (const attribute of ATTRIBUTES) {
      await upsert(queryInterface, attribute, transaction);
    }
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(`DELETE FROM attribute_definitions WHERE attribute_code IN (:codes);`, {
      transaction,
      replacements: { codes: ATTRIBUTES.map((attribute) => attribute.code) },
    });
  });
}
