/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Que nadie pueda editar ni borrar lo que se dijo, ni siquiera con acceso a la base.
 * @system instala triggers append-only sobre transcripción, historia del caso y evidencia de soporte.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('support_messages');

/** Tablas donde una fila escrita ya no se toca: ni UPDATE ni DELETE. */
const APPEND_ONLY = ['support_messages', 'support_case_events', 'support_message_relations'];

/** Tablas que sí evolucionan (un participante sale, un adjunto se escanea) pero nunca desaparecen. */
const NO_DELETE = [
  'support_cases',
  'support_channels',
  'support_channel_participants',
  'support_assignments',
  'support_resolutions',
  'support_case_links',
  'support_case_references',
  'support_case_feedback',
  'support_attachments',
];

/**
 * «No mostramos el botón de editar» no es un control: es una decisión de interfaz.
 *
 * Un backend puede tener un endpoint olvidado, un script de mantenimiento o una consola SQL abierta
 * en producción. Cualquiera de los tres puede hacer un UPDATE sobre un mensaje y dejar la
 * conversación diciendo algo distinto de lo que se dijo, sin que nada quede registrado. La cadena de
 * hash hace ese cambio DETECTABLE después; estos triggers lo hacen IMPOSIBLE ahora, y las dos cosas
 * se necesitan: la cadena prueba, el trigger impide.
 *
 * ## Por qué un trigger y no `REVOKE UPDATE, DELETE` al rol de aplicación
 *
 * Porque el revoke depende de que los roles existan con el nombre esperado en cada entorno, y una
 * base provisionada a mano —o un contenedor de desarrollo que corre como superusuario— se queda sin
 * la protección justo donde alguien va a experimentar. El trigger viaja con el esquema: existe en
 * todos los entornos, incluido el portátil donde se reproduce el bug. `bootstrap-db-roles` sigue
 * quitando privilegios de más; esto es la red que no depende de que aquello se haya corrido.
 *
 * ## Por qué dos niveles y no uno
 *
 * `support_messages` y `support_case_events` no cambian NUNCA: una corrección es un mensaje nuevo
 * enlazado al anterior (`CORRECTS`), y una redacción es un evento nuevo, no un borrado del texto
 * original. En cambio un participante sale del canal y un adjunto termina de escanearse: ahí el
 * UPDATE es legítimo y lo prohibido es la desaparición. Aplicar el mismo candado a todo habría
 * obligado a burlarlo para operar, que es como mueren los controles.
 *
 * ## El borrado que sí existe
 *
 * Es lógico (`_deleted`) y, para un contenido que la ley obliga a destruir, la destrucción de la
 * clave del payload cifrado. Nunca un DELETE que haga desaparecer la fila y con ella la prueba de
 * que el registro existió. Que una disposición ocurrió también es información.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE OR REPLACE FUNCTION ${SCHEMA}.forbid_update_and_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SUPPORT_APPEND_ONLY_VIOLATION: % no admite % (tabla append-only)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;`);

  await queryInterface.sequelize.query(`
CREATE OR REPLACE FUNCTION ${SCHEMA}.forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SUPPORT_DELETE_FORBIDDEN: % sólo admite borrado lógico', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;`);

  for (const table of APPEND_ONLY) {
    await queryInterface.sequelize.query(`
DROP TRIGGER IF EXISTS trg_${table}_append_only ON ${SCHEMA}.${table};
CREATE TRIGGER trg_${table}_append_only
  BEFORE UPDATE OR DELETE ON ${SCHEMA}.${table}
  FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.forbid_update_and_delete();`);
  }

  for (const table of NO_DELETE) {
    await queryInterface.sequelize.query(`
DROP TRIGGER IF EXISTS trg_${table}_no_delete ON ${SCHEMA}.${table};
CREATE TRIGGER trg_${table}_no_delete
  BEFORE DELETE ON ${SCHEMA}.${table}
  FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.forbid_delete();`);
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const table of APPEND_ONLY) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_${table}_append_only ON ${SCHEMA}.${table};`);
  }
  for (const table of NO_DELETE) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_${table}_no_delete ON ${SCHEMA}.${table};`);
  }
  await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS ${SCHEMA}.forbid_update_and_delete();`);
  await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS ${SCHEMA}.forbid_delete();`);
}
