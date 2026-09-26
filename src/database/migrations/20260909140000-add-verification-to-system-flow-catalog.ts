/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const FLOWS = `${atlasSchemaFor('system_flow_catalog')}.system_flow_catalog`;

/**
 * Flujos, fase 3: la verificación en runtime.
 *
 * `verification` ya existía como eje (UNVERIFIED/VERIFIED/BROKEN); lo que faltaba era la
 * EVIDENCIA: cuándo se verificó, quién lanzó la verificación y con qué corridas. La fuente es
 * `system_action_logs`, que ya guarda método, plantilla de ruta, estado, duración y
 * `correlation_id` de cada request: no hace falta instrumentar nada nuevo, sólo cruzarlo.
 * `verification_evidence_json` guarda el resumen (cuántas respuestas < 500 y ≥ 500, la última
 * fecha, una muestra de `correlation_id`) para que la ficha pueda decir «verificado por 14
 * corridas, la última el …» y no sólo «VERIFIED».
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${FLOWS}
  ADD COLUMN IF NOT EXISTS verified_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by                VARCHAR(80),
  ADD COLUMN IF NOT EXISTS verification_evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${FLOWS}
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS verified_by,
  DROP COLUMN IF EXISTS verification_evidence_json;
`);
}
