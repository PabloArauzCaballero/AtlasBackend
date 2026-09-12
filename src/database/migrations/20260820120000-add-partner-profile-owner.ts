/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza impide que un comercio opere sobre el expediente de otro.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const PROFILES = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;

/**
 * De quién es el expediente.
 *
 * Hallazgo de la revisión de seguridad del 20-ago-2026: `partner_profiles` no tenía NINGUNA columna
 * de dueño, y todos los endpoints del onboarding admiten el rol `merchant` identificando el
 * expediente por `:partnerId` en la URL. Sin dueño no había nada contra lo que comprobar, así que
 * cualquier usuario de comercio autenticado podía leer y modificar el expediente de otro comercio
 * del mismo tenant — incluidos sus QR de cobro, que dicen a qué cuenta va el dinero.
 *
 * Nullable a propósito: los expedientes que ya existen no tienen dueño conocido y no se puede
 * inventar. `assertOwnPartnerResource` trata «sin dueño» como accesible sólo para roles internos,
 * que es la lectura conservadora — un expediente huérfano deja de ser autoservicio hasta que
 * alguien lo reasigne, en vez de quedar abierto a todos los comercios del tenant.
 *
 * El índice acompaña a la comprobación de propiedad y a la pregunta natural del portal: «¿qué
 * expedientes son míos?». Va sobre `_tenant_id`, con el guion bajo que este esquema antepone a
 * sus columnas de sistema.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${PROFILES}
  ADD COLUMN IF NOT EXISTS owner_merchant_user_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_partner_profiles_tenant_owner
  ON ${PROFILES} (_tenant_id, owner_merchant_user_id);`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ${atlasSchemaFor('partner_profiles')}.idx_partner_profiles_tenant_owner;

ALTER TABLE ${PROFILES}
  DROP COLUMN IF EXISTS owner_merchant_user_id;`);
}
