/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El core tiene que poder HACER CUMPLIR el precio que decide el Motor, no sólo mostrarlo.
 * @system añade el rango de tasa por producto y la tasa/tier que decidió el Motor por solicitud (Frente 3A).
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const PRODUCTS = `${atlasSchemaFor('credit_products')}.credit_products`;
const APPLICATIONS = `${atlasSchemaFor('credit_applications')}.credit_applications`;

/**
 * Plan `_plan-motor-decisiones-tasa-2026-09-25/PLAN.md`, §1.1 «El core hace cumplir el precio».
 *
 * ## Lo que pasaba (T-1, T-5)
 *
 * `credit_products.annual_interest_rate` es una tasa única, sin rango: nada impedía que el
 * desembolso aceptara —o que una futura decisión del Motor propusiera— una tasa fuera de lo que el
 * producto puede cobrar. Y no existía NINGÚN suelo: un producto sin tasa desembolsaba al 0 %.
 *
 * ## Lo que se añade
 *
 * - `credit_products.min_annual_interest_rate` / `max_annual_interest_rate`: el rango declarado del
 *   producto, en PORCENTAJE (mismo vocabulario que `annual_interest_rate`). Ambas NULLABLE: un
 *   producto sin rango declarado no rompe nada al migrar — el desembolso cae al comportamiento
 *   defensivo del código (clamp sólo al tope de usura, y 422 si tampoco hay tasa ni decisión).
 * - `credit_applications.decision_priced_rate`: la tasa que decidió el Motor para ESTA solicitud, ya
 *   en PORCENTAJE (se convierte desde tanto por uno al persistirla; ver `rate-units.ts`).
 * - `credit_applications.decision_pricing_tier`: el tramo de precio que publicó el Motor
 *   (`pricing_tier`), como texto corto.
 *
 * Sin `UPDATE`: las solicitudes y productos anteriores quedan con estas columnas en NULL. No se
 * rellenan por deducción — un producto sin rango declarado hoy no tenía uno, y no se le puede
 * inventar un mínimo o un máximo que nadie fijó.
 *
 * El CHECK de rango es opcional a propósito (`min IS NULL OR max IS NULL OR min <= max`): permite
 * declarar sólo un suelo o sólo un techo, y sólo obliga la relación cuando los DOS existen.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${PRODUCTS}
  ADD COLUMN IF NOT EXISTS min_annual_interest_rate NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS max_annual_interest_rate NUMERIC(7,4);
`);

  await queryInterface.sequelize.query(`
ALTER TABLE ${PRODUCTS} DROP CONSTRAINT IF EXISTS ck_credit_products_rate_range;
ALTER TABLE ${PRODUCTS} ADD CONSTRAINT ck_credit_products_rate_range
  CHECK (min_annual_interest_rate IS NULL OR max_annual_interest_rate IS NULL OR min_annual_interest_rate <= max_annual_interest_rate);
`);

  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  ADD COLUMN IF NOT EXISTS decision_priced_rate  NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS decision_pricing_tier  VARCHAR(40);
`);

  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${PRODUCTS}.min_annual_interest_rate IS
     'Suelo del rango de tasa anual (porcentaje) que este producto puede cobrar. NULL = sin suelo declarado.'`,
  );
  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${PRODUCTS}.max_annual_interest_rate IS
     'Techo del rango de tasa anual (porcentaje) que este producto puede cobrar. NULL = sin techo declarado (manda igual el tope de usura).'`,
  );
  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${APPLICATIONS}.decision_priced_rate IS
     'Tasa anual (porcentaje) que decidió el Motor para esta solicitud (ATLAS_BNPL_UNDERWRITING v2, annual_percentage_rate convertido de tanto por uno). NULL si el Motor no la publicó o si la solicitud es anterior.'`,
  );
  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${APPLICATIONS}.decision_pricing_tier IS
     'Tramo de precio que publicó el Motor (pricing_tier), igual al código de la banda de riesgo. NULL si no vino.'`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  DROP COLUMN IF EXISTS decision_pricing_tier,
  DROP COLUMN IF EXISTS decision_priced_rate;
`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${PRODUCTS}
  DROP CONSTRAINT IF EXISTS ck_credit_products_rate_range,
  DROP COLUMN IF EXISTS max_annual_interest_rate,
  DROP COLUMN IF EXISTS min_annual_interest_rate;
`);
}
