/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza impide que un artefacto de Flujos viejo deshaga lo que ya se cargó.
 * @system añade a cada carga del artefacto la fecha en que se generó ese artefacto.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const IMPORTS = `${atlasSchemaFor('system_flow_imports')}.system_flow_imports`;

/**
 * `declaredCount` detecta un artefacto roto (su manifiesto y sus ficheros no cuadran), pero no uno VIEJO y coherente
 * consigo mismo: recargar el de ayer pasaba la comprobación y retiraba lo que el código ya tiene. Con la fecha de
 * generación de cada carga, la importación rechaza volver a un artefacto anterior al último cargado.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${IMPORTS} ADD COLUMN IF NOT EXISTS artifact_generated_at TIMESTAMPTZ;`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${IMPORTS} DROP COLUMN IF EXISTS artifact_generated_at;`);
}
