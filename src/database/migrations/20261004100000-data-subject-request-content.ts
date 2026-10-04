/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Lo que la persona escribía al pedir corregir o borrar sus datos se perdía, y una corrección no decía qué corregir: ni una persona ni el Motor podían decidir.
 * @system `data_subject_requests` guarda el texto, el campo a corregir (vocabulario cerrado), el valor propuesto CIFRADO y cuándo confirmó el PIN la persona.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLA = `${atlasSchemaFor('data_subject_requests')}.data_subject_requests`;

/** Mismo vocabulario que `RECTIFICATION_FIELDS` (customer-privacy/data-subject-request.content.ts). */
const CAMPOS = [
  'address',
  'zone',
  'city',
  'address_reference',
  'occupation',
  'employer',
  'declared_income',
  'first_name',
  'last_name',
  'birth_date',
  'document_number',
  'phone',
  'email',
  'other',
];

/**
 * Sólo añade columnas: las filas existentes quedan con NULL (no hay de dónde reconstruir lo que se perdió). La vista de
 * `read_api` que lee esta tabla selecciona columnas por nombre, así que no cambia.
 *
 * `proposed_value_encrypted` es BYTEA con un sobre cifrado, como los contactos: el valor que alguien quiere poner en su
 * ficha es un dato personal y no debe quedar legible en la base ni en un volcado.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${TABLA}
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS rectification_field VARCHAR(40),
  ADD COLUMN IF NOT EXISTS proposed_value_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS pin_verified_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ck_data_subject_requests_rectification_field;
ALTER TABLE ${TABLA}
  ADD CONSTRAINT ck_data_subject_requests_rectification_field
  CHECK (rectification_field IS NULL OR rectification_field IN (${CAMPOS.map((c) => `'${c}'`).join(', ')}));
`);
}

/**
 * Bajar borraría lo que la gente escribió en sus solicitudes. Si ya hay contenido, se aborta con un mensaje: perderlo en
 * silencio es justo el defecto que esta migración arregla.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COUNT(*)::int AS n FROM ${TABLA}
      WHERE description IS NOT NULL OR rectification_field IS NOT NULL OR proposed_value_encrypted IS NOT NULL`,
  );
  const conContenido = Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
  if (conContenido > 0) {
    throw new Error(
      `No se puede revertir: ${conContenido} solicitud(es) del titular ya guardan su texto o su corrección. ` +
        'Revertir borraría lo que escribieron esas personas; resuélvelo a mano antes de bajar esta migración.',
    );
  }
  await queryInterface.sequelize.query(`
ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ck_data_subject_requests_rectification_field;
ALTER TABLE ${TABLA}
  DROP COLUMN IF EXISTS pin_verified_at,
  DROP COLUMN IF EXISTS proposed_value_encrypted,
  DROP COLUMN IF EXISTS rectification_field,
  DROP COLUMN IF EXISTS description;
`);
}
