/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza dice en qué comercio nació cada crédito, que es de dónde sale su categoría.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const APPLICATIONS = `${atlasSchemaFor('credit_applications')}.credit_applications`;
const LOANS = `${atlasSchemaFor('loans')}.loans`;

/**
 * En qué comercio se hizo la compra.
 *
 * Faltaba el eslabón entero. `loans` sabe de qué solicitud viene y qué producto financia;
 * `credit_applications` sabe qué cliente pidió y qué decidió el motor. **Ninguna de las dos sabe
 * dónde se compró.** Y sin eso no hay categoría de qué hablar: la categoría no vive en el crédito,
 * vive en el comercio (`partner_profiles.business_category`), así que un gasto sólo se puede
 * clasificar si antes se sabe a qué comercio pertenece.
 *
 * Es también lo que le faltaba a `business_acceptance`, que llegó el 19-ago con sus estados
 * (`pending → accepted/declined`) pero sin decir **qué comercio** debe pronunciarse. Una aceptación
 * pendiente sin destinatario no se la puede reclamar nadie.
 *
 * ## Por qué en las dos tablas y no sólo en la solicitud
 *
 * La solicitud es la que nace en el comercio, así que ahí está el dato de origen. Pero el préstamo
 * es lo que se consulta después —cuotas, mora, gasto por categoría— y hacerlo pasar siempre por su
 * solicitud convierte cada pregunta del cliente en una unión más. El libro de préstamos ya guarda
 * copia del producto y de la traza al motor por la misma razón: es un libro, y un libro se lee
 * entero por sí mismo. Se copia en el desembolso, que es cuando el crédito deja de poder cambiar
 * de comercio.
 *
 * ## Por qué BIGINT suelto y no una clave foránea
 *
 * `partner_profiles` vive en otro esquema de dominio. Esta base referencia entre dominios por
 * identificador, sin FK —`credit_applications.customer_id` lleva así desde el principio—, y romper
 * esa convención aquí ataría el ciclo de vida del crédito al del expediente del comercio: no se
 * podría archivar un comercio sin tocar créditos ya cerrados. La integridad entre dominios la
 * sostiene el servicio, que es donde se puede explicar el error.
 *
 * Nullable a propósito. Los créditos que ya existen se originaron antes de que el comercio se
 * registrara en el expediente y **no se puede inventar de cuál vinieron**. Quedan sin comercio y
 * el dashboard los agrupa aparte; poner un valor por defecto sería fabricar el dato que justamente
 * se quiere que sea real.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${APPLICATIONS}
  ADD COLUMN IF NOT EXISTS partner_profile_id BIGINT;

CREATE INDEX IF NOT EXISTS credit_applications_partner_profile_idx
  ON ${APPLICATIONS} (_tenant_id, partner_profile_id);`);

  /*
   * El índice parcial responde la pregunta del portal del comercio —«¿qué tengo pendiente de
   * aceptar?»— sin recorrer el histórico. El de `business_acceptance` que ya existía no servía:
   * filtra por estado pero no por comercio, así que cada portal leía las pendientes de todos.
   */
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS credit_applications_partner_pendientes_idx
  ON ${APPLICATIONS} (_tenant_id, partner_profile_id)
  WHERE business_acceptance = 'pending';`);

  await queryInterface.sequelize.query(`
ALTER TABLE ${LOANS}
  ADD COLUMN IF NOT EXISTS partner_profile_id BIGINT;

CREATE INDEX IF NOT EXISTS loans_partner_profile_idx
  ON ${LOANS} (_tenant_id, partner_profile_id);`);

  /*
   * Relleno de los préstamos ya existentes desde su solicitud. Hoy no aporta nada —ninguna
   * solicitud tiene comercio todavía—, pero deja la migración correcta el día que se ejecute sobre
   * una base donde el orden haya sido el contrario.
   */
  await queryInterface.sequelize.query(`
UPDATE ${LOANS} l
   SET partner_profile_id = a.partner_profile_id
  FROM ${APPLICATIONS} a
 WHERE a._id = l.credit_application_id
   AND a._tenant_id = l._tenant_id
   AND l.partner_profile_id IS NULL
   AND a.partner_profile_id IS NOT NULL;`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ${atlasSchemaFor('loans')}.loans_partner_profile_idx;

ALTER TABLE ${LOANS}
  DROP COLUMN IF EXISTS partner_profile_id;`);

  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ${atlasSchemaFor('credit_applications')}.credit_applications_partner_pendientes_idx;
DROP INDEX IF EXISTS ${atlasSchemaFor('credit_applications')}.credit_applications_partner_profile_idx;

ALTER TABLE ${APPLICATIONS}
  DROP COLUMN IF EXISTS partner_profile_id;`);
}
