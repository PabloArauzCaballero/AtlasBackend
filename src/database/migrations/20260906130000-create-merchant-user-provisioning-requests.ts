/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { DataTypes, QueryInterface } from 'sequelize';
import { ATLAS_SCHEMAS } from '../domain-schemas.js';

type MigrationContext = {
  context: QueryInterface;
};

const TABLE = { tableName: 'merchant_user_provisioning_requests', schema: ATLAS_SCHEMAS.IAM };

/**
 * La cola de altas de identidad de comercio, encolada por el ERP.
 *
 * ## Qué arregla
 *
 * El alta de una identidad de comercio se hacía TECLEÁNDOLA en el portal interno: correo, nombre y
 * una contraseña provisional escritos a mano por un operador. Eso convertía al portal en el ORIGEN
 * del usuario de comercio, cuando el origen es el ERP —allí se firma la relación comercial, allí
 * está la cuenta B2B, la sucursal y el rol que le corresponde—. Las consecuencias eran dos, y
 * ninguna se veía desde la pantalla:
 *
 * 1. **Dos altas que no se hablan.** El ERP creaba su `atlas_sales.merchant_users` con `user_id`
 *    nulo y el portal creaba la identidad por su cuenta. Nada garantizaba que el correo coincidiera,
 *    así que el enlace preferente por `user_id` quedaba vacío para siempre y todo se resolvía por
 *    el enlace de respaldo (el correo). Un dedazo en el correo dejaba a la persona sin alcance, con
 *    identidad válida y sesión que iniciaba: el 403 llegaba después, en el portal del comercio.
 * 2. **Un alta sin expediente.** Nadie podía responder «¿quién pidió este acceso y por qué?»,
 *    porque la petición no existía en ninguna parte: sólo su resultado.
 *
 * Esta tabla es la petición. El ERP la encola cuando registra al usuario en su CRM; el personal
 * interno la aprueba o la rechaza desde el portal, y la identidad se crea CON LOS DATOS DE LA
 * PETICIÓN. El portal deja de poder inventarse un usuario de comercio.
 *
 * ## Lo que esta tabla NO es
 *
 * No es la membresía. Sigue sin vivir aquí a qué comercio pertenece la persona: `account_reference`
 * y `account_name` son una COPIA para que el operador sepa qué está aprobando sin salir de la
 * pantalla, no la fuente de verdad. Quien manda sobre la relación comercial es el ERP, y el enlace
 * de vuelta es `merchant_user_id`, que el ERP lee para rellenar su `user_id`.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.createTable(TABLE, {
    _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
    _tenant_id: { type: DataTypes.BIGINT, allowNull: false },
    /** Quién encoló. Hoy sólo el ERP; la columna existe para que un segundo origen no obligue a migrar. */
    source: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'erp' },
    /** El identificador de la fila del ERP que originó la petición (`atlas_sales.merchant_users.id`). */
    external_reference: { type: DataTypes.STRING(120), allowNull: false },
    account_reference: { type: DataTypes.STRING(120), allowNull: true },
    account_name: { type: DataTypes.STRING(180), allowNull: true },
    branch_name: { type: DataTypes.STRING(180), allowNull: true },
    email: { type: DataTypes.STRING(180), allowNull: false },
    full_name: { type: DataTypes.STRING(180), allowNull: false },
    phone: { type: DataTypes.STRING(40), allowNull: true },
    /** El rol que el ERP le dio en su CRM. Informativo: la identidad nace siempre con rol `merchant`. */
    role_code: { type: DataTypes.STRING(80), allowNull: true },
    /** Quién lo pidió en el ERP, tal y como el ERP lo identifica. Texto: no es una FK a esta base. */
    requested_by: { type: DataTypes.STRING(180), allowNull: true },
    requested_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'pending' },
    /** La identidad creada al aprobar. Es el enlace que el ERP copia en su `user_id`. */
    merchant_user_id: { type: DataTypes.BIGINT, allowNull: true },
    decided_at: { type: DataTypes.DATE, allowNull: true },
    decided_by_internal_user_id: { type: DataTypes.BIGINT, allowNull: true },
    rejection_reason: { type: DataTypes.STRING(500), allowNull: true },
    _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    _updated_at: { type: DataTypes.DATE, allowNull: true },
  });

  // Una fila del ERP produce UNA petición. Sin esto, un reintento del ERP —que es lo normal cuando
  // la red se corta después de escribir— encola un duplicado y el operador ve la misma alta dos
  // veces sin forma de saber cuál atender.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ux_merchant_user_prov_req_external"
       ON "${ATLAS_SCHEMAS.IAM}"."merchant_user_provisioning_requests" ("_tenant_id", "source", "external_reference");`,
  );

  // Y un correo no puede tener DOS peticiones pendientes a la vez: aprobar la segunda chocaría
  // contra el índice único de `merchant_users` y el operador vería un 409 sin saber por qué.
  // Parcial sobre `pending` a propósito: el histórico de rechazos y de altas sí se repite.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ux_merchant_user_prov_req_pending_email"
       ON "${ATLAS_SCHEMAS.IAM}"."merchant_user_provisioning_requests" ("_tenant_id", lower(btrim("email")))
       WHERE status = 'pending';`,
  );

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS "ix_merchant_user_prov_req_status"
       ON "${ATLAS_SCHEMAS.IAM}"."merchant_user_provisioning_requests" ("_tenant_id", "status", "requested_at");`,
  );

  await queryInterface.sequelize.query(
    `ALTER TABLE "${ATLAS_SCHEMAS.IAM}"."merchant_user_provisioning_requests"
       ADD CONSTRAINT "ck_merchant_user_prov_req_status"
       CHECK (status IN ('pending', 'provisioned', 'rejected'));`,
  );

  // Una petición resuelta tiene que decir CÓMO se resolvió. Sin esta comprobación, un UPDATE a
  // medias deja una fila «provisioned» sin identidad detrás: la pantalla la da por atendida y el
  // usuario del comercio nunca recibe acceso.
  await queryInterface.sequelize.query(
    `ALTER TABLE "${ATLAS_SCHEMAS.IAM}"."merchant_user_provisioning_requests"
       ADD CONSTRAINT "ck_merchant_user_prov_req_resolution"
       CHECK (
         (status = 'pending' AND merchant_user_id IS NULL AND rejection_reason IS NULL AND decided_at IS NULL)
         OR (status = 'provisioned' AND merchant_user_id IS NOT NULL AND decided_at IS NOT NULL)
         OR (status = 'rejected' AND rejection_reason IS NOT NULL AND decided_at IS NOT NULL)
       );`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${ATLAS_SCHEMAS.IAM}"."ix_merchant_user_prov_req_status";`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${ATLAS_SCHEMAS.IAM}"."ux_merchant_user_prov_req_pending_email";`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${ATLAS_SCHEMAS.IAM}"."ux_merchant_user_prov_req_external";`);
  await queryInterface.dropTable(TABLE);
}
