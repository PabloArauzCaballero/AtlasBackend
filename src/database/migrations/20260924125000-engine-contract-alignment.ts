/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Core se alinea con el contrato nuevo del motor: base habilitante antes de decidir,
 *   vigencia de la decisión que publica el motor y altas de créditos rechazadas para siempre.
 * @system réplicas `superseded` con motivo, versión del texto, `decision_valid_until` de la solicitud
 *   y la marca de rechazo terminal del alta del crédito en el motor.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const REPLICATIONS = `${atlasSchemaFor('decision_consent_replications')}.decision_consent_replications`;
const APPLICATIONS = `${atlasSchemaFor('credit_applications')}.credit_applications`;
const LOANS = `${atlasSchemaFor('loans')}.loans`;

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * `superseded`: el motor respondió 409 `CONSENT_GRANT_REPLAYED` o `CONSENT_REVOCATION_STALE`. La
   * réplica está resuelta —el motor ya conoce un estado más nuevo— y reintentarla no cambia nada. Se
   * guarda el motivo en `resolution_code` para que se vea por qué no se entregó. El CHECK se amplía
   * ANTES de que ningún código escriba el valor nuevo.
   */
  await queryInterface.sequelize.query(`
ALTER TABLE ${REPLICATIONS} DROP CONSTRAINT IF EXISTS decision_consent_replications_status_check;
ALTER TABLE ${REPLICATIONS} DROP CONSTRAINT IF EXISTS ck_decision_consent_replications_status;
ALTER TABLE ${REPLICATIONS}
  ADD CONSTRAINT ck_decision_consent_replications_status CHECK (status IN ('pending','synced','superseded'));
ALTER TABLE ${REPLICATIONS}
  ADD COLUMN IF NOT EXISTS resolution_code VARCHAR(60),
  ADD COLUMN IF NOT EXISTS consent_version VARCHAR(40);
`);

  /*
   * La vigencia que el motor pone a SU decisión (`decisionValidUntil`, 1 h por omisión). La concesión
   * usa lo primero que venza entre ésta y `decided_at + CREDIT_DECISION_VALIDITY_HOURS`. Nula en las
   * decisiones humanas y en las anteriores a este contrato: rige sólo la del core.
   */
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS} ADD COLUMN IF NOT EXISTS decision_valid_until TIMESTAMPTZ;
`);

  /*
   * Un alta que el motor rechaza por una causa que reintentar no arregla (la referencia ya está atada
   * a otra decisión, la decisión no terminó, no existe o no tiene sujeto) sale de la cola con su
   * código, en vez de reenviarse en cada pasada para siempre. Sigue visible: la conciliación la cuenta.
   */
  await queryInterface.sequelize.query(`
ALTER TABLE ${LOANS}
  ADD COLUMN IF NOT EXISTS decision_facility_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_facility_rejection_code VARCHAR(60);
`);
}

/** No se revierte con réplicas `superseded`: el CHECK anterior no puede representarlas. */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ${REPLICATIONS} WHERE status = 'superseded') THEN
    RAISE EXCEPTION 'hay réplicas superseded: el CHECK anterior no las admite, no se revierte';
  END IF;
END $$;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${LOANS} DROP COLUMN IF EXISTS decision_facility_rejection_code, DROP COLUMN IF EXISTS decision_facility_rejected_at;
ALTER TABLE ${APPLICATIONS} DROP COLUMN IF EXISTS decision_valid_until;
ALTER TABLE ${REPLICATIONS} DROP COLUMN IF EXISTS consent_version, DROP COLUMN IF EXISTS resolution_code;
ALTER TABLE ${REPLICATIONS} DROP CONSTRAINT IF EXISTS ck_decision_consent_replications_status;
ALTER TABLE ${REPLICATIONS} DROP CONSTRAINT IF EXISTS decision_consent_replications_status_check;
ALTER TABLE ${REPLICATIONS}
  ADD CONSTRAINT decision_consent_replications_status_check CHECK (status IN ('pending','synced'));
`);
}
