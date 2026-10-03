/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Atlas ya no ofrece desde la app llevarse los datos, limitar su uso ni retirar consentimientos: sólo corregir un dato y borrar la cuenta.
 * @system retira del contenido editable las piezas `derecho.portability|restriction|revocation` de la superficie `privacy`.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('app_content_entries')}.app_content_entries`;
const CLAVES = ['derecho.portability', 'derecho.restriction', 'derecho.revocation'];
const lista = CLAVES.map((clave) => `'${clave}'`).join(', ');

/**
 * La decisión de producto (2026-10-02) es que esos tres derechos no se ofrecen. La app ya no los pinta
 * y el backend ya no los acepta; estas piezas quedaban en el portal como textos «editables» de una
 * opción que no existe, y quien las editara creería estar cambiando algo visible.
 *
 * Se RETIRAN —borrado lógico— y no se borran: el `down` las devuelve tal cual estaban, y si alguien las
 * había reescrito en el portal no se pierde su texto.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
UPDATE ${TABLE}
   SET is_active = FALSE,
       _deleted = TRUE,
       _updated_at = NOW()
 WHERE surface = 'privacy'
   AND content_key IN (${lista})
   AND _deleted IS DISTINCT FROM TRUE;`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
UPDATE ${TABLE}
   SET is_active = TRUE,
       _deleted = FALSE,
       _updated_at = NOW()
 WHERE surface = 'privacy'
   AND content_key IN (${lista});`);
}
