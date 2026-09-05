/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business La solicitud recuerda en qué caja del comercio nació, para que el comercio sepa cuál es.
 * @system añade `credit.credit_applications.pos_terminal_id`.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('credit_applications')}.credit_applications`;

/**
 * En qué caja del comercio se originó la compra.
 *
 * El QR que el cliente escanea ES el serial de un terminal, y de ahí cuelga la sucursal. Hasta
 * ahora la solicitud sólo guardaba el comercio (`partner_profile_id`), así que cuando llegaba al
 * portal del negocio éste no podía saber en cuál de sus locales se hizo la venta —la primera
 * pregunta de cualquier reclamo—. Es opcional a propósito: una renovación o un alta desde el portal
 * interno no nacen en una caja, y exigirlo rompería esos casos.
 *
 * Se guarda el TERMINAL y no la sucursal directamente porque el terminal es el dato que el cliente
 * resolvió de verdad; la sucursal se deriva de él. Si un POS se muda de local, la solicitud vieja
 * sigue apuntando a dónde ocurrió el cobro, que es lo correcto para un histórico.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS pos_terminal_id BIGINT NULL`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS pos_terminal_id`);
}
