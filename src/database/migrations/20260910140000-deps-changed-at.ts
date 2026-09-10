/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza permite que un aviso de «desactualizado» se pueda apagar cuando deja de ser cierto.
 * @system guarda cuándo cambió el código de un flujo, para poder devolverlo a FRESH con criterio.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const FLOWS = `${atlasSchemaFor('system_flow_catalog')}.system_flow_catalog`;

/**
 * STALE era un trinquete: nada devolvía un flujo a FRESH.
 *
 * Un flujo que cambia pasa a STALE, y ahí se quedaba aunque se desplegara, se ejercitara y se
 * volviera a verificar. Recarga tras recarga el conjunto sólo crecía, así que en unas semanas se
 * volvía otra vez «un aviso que salta siempre», que es justo el fallo que la ola anterior arregló.
 *
 * Con `deps_changed_at` la vuelta tiene criterio: un flujo deja de estar desactualizado cuando se
 * verifica con corridas POSTERIORES al cambio. Verificarlo con corridas anteriores no dice nada
 * sobre el código nuevo —esas corridas ejercitaron el viejo—, y darlo por fresco sería exactamente
 * la clase de dato plausible y falso que esta herramienta existe para evitar.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${FLOWS}
  ADD COLUMN IF NOT EXISTS deps_changed_at TIMESTAMPTZ;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${FLOWS} DROP COLUMN IF EXISTS deps_changed_at;`);
}
