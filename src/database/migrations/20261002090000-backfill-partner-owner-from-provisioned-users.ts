/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza devuelve a cada comercio su expediente —con los datos que el ERP ya cargó— en lugar de un formulario vacío.
 * @system asigna dueño a los expedientes sin dueño cuya cuenta del ERP ya tiene un usuario de comercio concedido.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const PROFILES = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;
const REQUESTS = `${atlasSchemaFor('merchant_user_provisioning_requests')}.merchant_user_provisioning_requests`;

/**
 * Repara los expedientes que el ERP abrió sin dueño y cuyo usuario ya había recibido acceso: el
 * comercio entraba y «Mi empresa» le pedía abrir un expediente desde cero. Mismo criterio que
 * `adoptPartnerOwnerForAccount`: la primera persona concedida por esa cuenta, y sólo donde NO hay
 * dueño. Sólo escribe `owner_merchant_user_id`; no hay CHECK ni enum que ampliar.
 *
 * El `down` no hace nada a propósito: no se puede distinguir un dueño puesto aquí de uno legítimo.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
UPDATE ${PROFILES} p
   SET owner_merchant_user_id = r.merchant_user_id,
       _updated_at = NOW()
  FROM (
    SELECT DISTINCT ON (_tenant_id, account_reference) _tenant_id, account_reference, merchant_user_id
      FROM ${REQUESTS}
     WHERE status = 'provisioned' AND merchant_user_id IS NOT NULL AND account_reference IS NOT NULL
     ORDER BY _tenant_id, account_reference, decided_at ASC NULLS LAST, _id ASC
  ) r
 WHERE p._tenant_id = r._tenant_id
   AND p.erp_account_id = r.account_reference
   AND p.owner_merchant_user_id IS NULL
   AND p._deleted = FALSE;`);
}

export async function down(): Promise<void> {
  // Sin vuelta atrás: ver el comentario de `up`.
}
