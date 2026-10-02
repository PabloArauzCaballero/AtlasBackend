/**
 * @file Utilidad acotada: asigna dueño a los expedientes de partner que no lo tienen.
 * @business Esta pieza hace que el comercio vea su expediente —con los datos que el ERP ya cargó— en cuanto tiene acceso, en vez de un formulario vacío.
 * @system resuelve en una sola sentencia idempotente el puente cuenta del ERP → expediente → usuario de comercio.
 */
import { QueryTypes, Sequelize, Transaction } from 'sequelize';
import { atlasSchemaFor } from './domain-schemas.js';

const PROFILES = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;
const REQUESTS = `${atlasSchemaFor('merchant_user_provisioning_requests')}.merchant_user_provisioning_requests`;

/**
 * Da dueño a los expedientes SIN dueño de una cuenta del ERP, con la primera persona a la que se le
 * concedió acceso por esa cuenta.
 *
 * ## Por qué existe
 *
 * El ERP abre el expediente del comercio SIN dueño (`erp-merchant-expediente`: «el dueño lo pone el
 * alta de su usuario») y el alta del usuario nunca lo ponía. Como `GET /partner-onboarding/mine`
 * busca sólo por dueño, el comercio entraba y «Mi empresa» le pedía abrir un expediente desde cero,
 * con el formulario en blanco, aunque su razón social, su NIT y su correo ya estaban cargados.
 *
 * Los dos sucesos que cierran el puente pueden llegar en CUALQUIER orden —se concede el acceso y
 * luego se enlaza la cuenta, o al revés—, así que esto se llama desde los dos sitios y es
 * idempotente: sólo toca filas con `owner_merchant_user_id IS NULL`, nunca reasigna un dueño.
 *
 * Un solo dueño por expediente es una decisión de seguridad (`assertOwnPartnerResource`): la
 * primera persona concedida lo es, y las siguientes del mismo comercio no se vuelven dueñas.
 *
 * @returns cuántos expedientes recibieron dueño.
 */
export async function adoptPartnerOwnerForAccount(
  connection: Sequelize,
  input: { tenantId: string; erpAccountId: string },
  transaction?: Transaction,
): Promise<number> {
  const [, filas] = (await connection.query(
    `UPDATE ${PROFILES} p
        SET owner_merchant_user_id = r.merchant_user_id,
            _updated_at = NOW()
       FROM (
         SELECT merchant_user_id
           FROM ${REQUESTS}
          WHERE _tenant_id = :tenantId
            AND account_reference = :erpAccountId
            AND status = 'provisioned'
            AND merchant_user_id IS NOT NULL
          ORDER BY decided_at ASC NULLS LAST, _id ASC
          LIMIT 1
       ) r
      WHERE p._tenant_id = :tenantId
        AND p.erp_account_id = :erpAccountId
        AND p.owner_merchant_user_id IS NULL
        AND p._deleted = FALSE`,
    { replacements: input, type: QueryTypes.UPDATE, transaction },
  )) as unknown as [unknown, number];
  return filas;
}
