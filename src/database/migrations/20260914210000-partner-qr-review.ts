/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El QR de cobro de un comercio lo revisa una persona antes de que un cliente lo vea.
 * @system añade a `partner_qr_codes` quién lo revisó y la nota de la revisión, para que un rechazo
 *   diga qué corregir y una aprobación tenga firma.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const QR_CODES = `${atlasSchemaFor('partner_qr_codes')}.partner_qr_codes`;

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * Hasta aquí ningún QR salía nunca de `pending_review`: no existía ruta ni pantalla que lo
   * activara, `verified_at` quedaba siempre nulo y el índice único de «un activo por ámbito» no se
   * ejercía jamás. El cliente recibía en la app un QR que ninguna persona había mirado.
   *
   * La revisión necesita dos cosas que la tabla no tenía: QUIÉN firmó (para la trazabilidad de una
   * cuenta de cobro) y una NOTA, que en el rechazo es lo que le dice al comercio qué corregir.
   */
  await queryInterface.sequelize.query(`
ALTER TABLE ${QR_CODES}
  ADD COLUMN IF NOT EXISTS reviewed_by_internal_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS review_note VARCHAR(400);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${QR_CODES}
  DROP COLUMN IF EXISTS review_note,
  DROP COLUMN IF EXISTS reviewed_by_internal_user_id;
`);
}
