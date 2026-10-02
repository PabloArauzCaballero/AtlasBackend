/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El QR de cobro lo confirma el propio comercio; Atlas ya no lo aprueba antes de que lo vean sus clientes.
 * @system activa los QR que quedaron en `pending_review` esperando una revisión interna que dejó de existir.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const QR_CODES = `${atlasSchemaFor('partner_qr_codes')}.partner_qr_codes`;
const NOTA = 'Activado al retirar la revisión interna del QR (2026-10-02).';

/**
 * Hasta el 2026-10-02 un QR nacía en `pending_review` y sólo una persona del portal interno lo
 * pasaba a `active`; mientras tanto el comercio veía «esperando revisión de Atlas · sus clientes
 * aún no lo ven». Pablo retiró esa puerta: el que cobra es el comercio y el QR nace activo. Los que
 * ya estaban esperando se activan aquí, SÓLO donde no hay otro activo en el mismo ámbito (el índice
 * único parcial no admite dos). Se deja la nota para poder distinguirlos y deshacerlo.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
UPDATE ${QR_CODES} q
   SET status = 'active',
       verified_at = NOW(),
       review_note = '${NOTA}',
       _updated_at = NOW()
 WHERE q.status = 'pending_review'
   AND NOT EXISTS (
     SELECT 1 FROM ${QR_CODES} a
      WHERE a._tenant_id = q._tenant_id
        AND a.partner_profile_id = q.partner_profile_id
        AND a.qr_kind = q.qr_kind
        AND a.branch_id IS NOT DISTINCT FROM q.branch_id
        AND a.status = 'active'
   );`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
UPDATE ${QR_CODES}
   SET status = 'pending_review',
       verified_at = NULL,
       review_note = NULL,
       _updated_at = NOW()
 WHERE status = 'active'
   AND review_note = '${NOTA}';`);
}
