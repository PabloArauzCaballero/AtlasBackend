/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza permite que un préstamo llegue a existir: su código no cabía en su columna.
 * @system amplía las columnas de código de entidad al ancho que el generador puede producir.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const LOANS = `${atlasSchemaFor('loans')}.loans`;
const PAYMENTS = `${atlasSchemaFor('loan_payments')}.loan_payments`;
const APPLICATIONS = `${atlasSchemaFor('credit_applications')}.credit_applications`;

/**
 * El código no cabía, y por eso NINGÚN préstamo podía desembolsarse.
 *
 * `createStableCode('LOAN')` produce `LOAN-` más un UUID: 5 + 36 = **41 caracteres** contra una
 * columna `VARCHAR(40)`. PostgreSQL respondía `value too long for type character varying(40)`, la
 * transacción entera se deshacía y `credit.loans` se quedaba vacía — no había un solo préstamo en
 * la base, así que pagos, cuotas y mora colgaban de una tabla que nunca se llenaba.
 *
 * `application_code` se salvaba por un pelo: `CRA-` son 4 + 36 = 40 exactos. Es decir, el esquema
 * funcionaba por casualidad y cualquier prefijo de más de tres letras lo rompía. Eso no es un
 * margen, es una trampa.
 *
 * ## Por qué 60 y no 41
 *
 * El generador admite prefijos de hasta 10 caracteres, así que el peor caso legítimo son 47. Se
 * amplía a 60 para que la columna deje de depender de cuántas letras eligió quien llamó a la
 * función: el ancho tiene que soportar lo que el generador PUEDE producir, no lo que produjo hoy.
 *
 * Ampliar un `VARCHAR` no reescribe la tabla ni invalida índices —es un cambio sólo de catálogo—,
 * así que es seguro sobre una base viva.
 */
/**
 * Las vistas de lectura leen estas columnas, y PostgreSQL no deja cambiar el tipo de una columna de
 * la que cuelga una vista: «cannot alter type of a column used by a view or rule». Se recogen sus
 * definiciones tal como están, se dejan caer, se amplía y se vuelven a crear con el MISMO texto.
 *
 * Se leen del catálogo en vez de copiarlas aquí a propósito: escribir una copia en la migración la
 * congelaría en el estado de hoy, y la siguiente migración que toque una vista dejaría esta con una
 * versión antigua que nadie miraría hasta que algo cuadrara mal en un informe.
 */
async function withDependentViewsRebuilt(queryInterface: QueryInterface, alter: () => Promise<void>): Promise<void> {
  const [rows] = (await queryInterface.sequelize.query(`
SELECT DISTINCT ns.nspname AS schema_name,
       view_class.relname AS view_name,
       pg_get_viewdef(view_class.oid, true) AS definition
FROM pg_depend d
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class view_class ON view_class.oid = r.ev_class
JOIN pg_namespace ns ON ns.oid = view_class.relnamespace
JOIN pg_class source_table ON source_table.oid = d.refobjid
JOIN pg_attribute a ON a.attrelid = source_table.oid AND a.attnum = d.refobjsubid
WHERE a.attname IN ('loan_code', 'payment_code', 'application_code')
  AND source_table.relname IN ('loans', 'loan_payments', 'credit_applications');`)) as unknown as [
    Array<{ schema_name: string; view_name: string; definition: string }>,
    unknown,
  ];

  for (const view of rows) {
    await queryInterface.sequelize.query(`DROP VIEW IF EXISTS "${view.schema_name}"."${view.view_name}" CASCADE;`);
  }

  await alter();

  for (const view of rows) {
    await queryInterface.sequelize.query(`CREATE OR REPLACE VIEW "${view.schema_name}"."${view.view_name}" AS ${view.definition}`);
  }
}

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await withDependentViewsRebuilt(queryInterface, async () => {
    await queryInterface.sequelize.query(`ALTER TABLE ${LOANS} ALTER COLUMN loan_code TYPE VARCHAR(60);`);
    await queryInterface.sequelize.query(`ALTER TABLE ${PAYMENTS} ALTER COLUMN payment_code TYPE VARCHAR(60);`);
    await queryInterface.sequelize.query(`ALTER TABLE ${APPLICATIONS} ALTER COLUMN application_code TYPE VARCHAR(60);`);
  });
}

/**
 * Estrechar de vuelta fallaría en cuanto exista un código que ya no quepa, que es justamente el
 * caso que esta migración vino a permitir. Se vuelve al ancho anterior sólo si nada lo impide: si
 * hay una fila más larga, PostgreSQL rechaza el `ALTER` y la reversión se detiene, que es el
 * comportamiento correcto — deshacer no puede significar perder un identificador.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await withDependentViewsRebuilt(queryInterface, async () => {
    await queryInterface.sequelize.query(`ALTER TABLE ${APPLICATIONS} ALTER COLUMN application_code TYPE VARCHAR(40);`);
    await queryInterface.sequelize.query(`ALTER TABLE ${PAYMENTS} ALTER COLUMN payment_code TYPE VARCHAR(40);`);
    await queryInterface.sequelize.query(`ALTER TABLE ${LOANS} ALTER COLUMN loan_code TYPE VARCHAR(40);`);
  });
}
