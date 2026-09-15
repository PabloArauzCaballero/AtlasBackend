/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const APPLICATIONS = `${atlasSchemaFor('credit_applications')}.credit_applications`;

/**
 * La aceptación del NEGOCIO sobre una solicitud que el motor ya aprobó.
 *
 * Faltaba un eslabón entero. Cuando el motor aprueba, la solicitud queda en `approved` y ese estado
 * está en `CLOSED_STATUSES`: **el negocio no puede pronunciarse** —el endpoint de decisión manual
 * responde `CREDIT_APPLICATION_ALREADY_DECIDED`—. Es decir, el motor no proponía: disponía.
 *
 * Y son dos preguntas distintas. El motor responde «¿este solicitante cumple los criterios de
 * riesgo?»; el negocio responde «¿queremos esta operación ahora?», que depende de cosas que el
 * motor no mira: cupo del mes, concentración en un comercio, una campaña que se cerró, liquidez.
 * Un motor que decide las dos deja al negocio sin volante.
 *
 * ## Por qué una columna nueva y no un estado nuevo
 *
 * Cambiar el `status` que escribe el motor —de `approved` a `engine_approved`— rompería en
 * silencio a todo lo que hoy filtra por `status = 'approved'`: reportes, tableros y cualquier
 * consulta ya escrita empezarían a devolver menos filas sin que nada fallara. La columna es
 * ADITIVA: quien no la mire sigue viendo lo de siempre, y quien decida desembolsar puede exigirla.
 *
 * `pending` sólo para lo que aprobó el MOTOR. Una aprobación firmada por una persona ya lleva
 * dentro la voluntad del negocio, así que pedirle una segunda aceptación sería pedir dos veces lo
 * mismo — y el segundo clic se acaba dando sin mirar.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  ADD COLUMN IF NOT EXISTS business_acceptance             VARCHAR(20),
  ADD COLUMN IF NOT EXISTS business_acceptance_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS business_acceptance_by          VARCHAR(160),
  ADD COLUMN IF NOT EXISTS business_acceptance_reason_code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS business_acceptance_notes       TEXT;`);

  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  DROP CONSTRAINT IF EXISTS credit_applications_business_acceptance_conocida;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  ADD CONSTRAINT credit_applications_business_acceptance_conocida
  CHECK (business_acceptance IS NULL OR business_acceptance IN ('pending', 'accepted', 'declined'));`);

  /*
   * Declinar sin motivo deja una operación rechazada que nadie puede explicar seis meses después,
   * y es justo la que se reclama. Aceptar no lo exige: el motivo es el propio análisis del motor.
   */
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  DROP CONSTRAINT IF EXISTS credit_applications_declinacion_motivada;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  ADD CONSTRAINT credit_applications_declinacion_motivada
  CHECK (business_acceptance <> 'declined' OR business_acceptance_reason_code IS NOT NULL);`);

  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS credit_applications_business_acceptance_idx
  ON ${APPLICATIONS} (_tenant_id, business_acceptance)
  WHERE business_acceptance = 'pending';`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  DROP CONSTRAINT IF EXISTS credit_applications_business_acceptance_conocida,
  DROP CONSTRAINT IF EXISTS credit_applications_declinacion_motivada;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  DROP COLUMN IF EXISTS business_acceptance,
  DROP COLUMN IF EXISTS business_acceptance_at,
  DROP COLUMN IF EXISTS business_acceptance_by,
  DROP COLUMN IF EXISTS business_acceptance_reason_code,
  DROP COLUMN IF EXISTS business_acceptance_notes;`);
}
