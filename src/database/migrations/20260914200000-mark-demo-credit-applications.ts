/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Separa las solicitudes de crédito SEMBRADAS de las reales para que ninguna métrica las mezcle.
 * @system marca `decision_mode = 'seed_demo'` en las solicitudes DEMO-* sin procedencia.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const APPLICATIONS = `${atlasSchemaFor('credit_applications')}.credit_applications`;

/**
 * Medido en la base desplegada el 2026-09-14: 600 solicitudes `DEMO-A-*`/`DEMO-R-*` (420 aprobadas,
 * 180 rechazadas) con `decision_mode` NULO y sin ejecución del Motor, junto a las DOS reales que sí
 * decidió el Motor. Se leían igual: cualquier tablero de «cuánto aprueba el Motor» sumaba 600
 * decisiones que nadie tomó. `seed_demo` es una procedencia honesta —«esto lo escribió un
 * sembrador»— y se aplica sólo a las que llevan el prefijo del sembrador y ninguna traza de
 * decisión; una solicitud real nunca se llama DEMO-.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * El CHECK de `decision_mode` (20260811100000) sólo admitía los tres modos del flujo vivo. La
   * procedencia de siembra es un cuarto valor legítimo y hay que declararlo ANTES del UPDATE: sin
   * esto la migración reventó en el despliegue (23514) y dejó la API sin arrancar.
   */
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS} DROP CONSTRAINT IF EXISTS ck_credit_applications_decision_mode;
ALTER TABLE ${APPLICATIONS} ADD CONSTRAINT ck_credit_applications_decision_mode
  CHECK (decision_mode IS NULL OR decision_mode IN ('decision_engine','manual','engine_unavailable_manual','seed_demo'));
`);
  await queryInterface.sequelize.query(`
UPDATE ${APPLICATIONS}
   SET decision_mode = 'seed_demo'
 WHERE decision_mode IS NULL
   AND decision_execution_id IS NULL
   AND application_code LIKE 'DEMO-%';
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
UPDATE ${APPLICATIONS}
   SET decision_mode = NULL
 WHERE decision_mode = 'seed_demo';
`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS} DROP CONSTRAINT IF EXISTS ck_credit_applications_decision_mode;
ALTER TABLE ${APPLICATIONS} ADD CONSTRAINT ck_credit_applications_decision_mode
  CHECK (decision_mode IS NULL OR decision_mode IN ('decision_engine','manual','engine_unavailable_manual'));
`);
}
