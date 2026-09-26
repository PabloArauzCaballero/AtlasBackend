/**
 * @file Borra los valores literales que Sequelize incrusta en el texto de una consulta.
 * @business Esta pieza evita que datos personales acaben en un almacén sin cifrado ni auditoría.
 * @system reescribe db.statement dejando la forma de la sentencia y quitando su contenido.
 */

/**
 * Por qué existe: **Sequelize NO siempre usa parámetros ligados.**
 *
 * Los `INSERT` que genera el ORM viajan con `$1..$n`, así que `enhancedDatabaseReporting: false`
 * basta para ellos. Pero las consultas con `replacements` y varios `WHERE` derivados del modelo
 * llegan al driver con el valor YA INCRUSTADO en el texto. Medido el 2026-09-18 contra este
 * backend: una sola petición de login produjo un `SELECT … WHERE identifier_hash =
 * '2a91be56…'`, es decir el identificador seudonimizado de una persona, camino de un backend de
 * trazas que no cifra, no filtra por inquilino y no audita quién lo consulta.
 *
 * La regla del repositorio ya lo decía para los logs —«nunca loguear SQL, Sequelize inlinea
 * valores»— y no se estaba aplicando al nuevo canal. Esto la aplica.
 *
 * Se conserva la FORMA de la sentencia (operación, tablas, columnas, nombres de parámetro),
 * que es lo que sirve para diagnosticar, y se descarta el contenido.
 */

/** Tope del texto publicado. Una sentencia enorme no diagnostica mejor y sí cuesta en cada span. */
export const MAX_STATEMENT_LENGTH = 1024;

const TRUNCATION_MARK = '…[recortado]';

/**
 * Sustituye todo literal de cadena por `'?'` y recorta.
 *
 * Los literales NUMÉRICOS se conservan a propósito: son límites, versiones e identificadores
 * internos (`LIMIT 50`, `_tenant_id = 3`), que sí ayudan a leer la consulta y que la política
 * admite como identificadores opacos. Lo que identifica a una persona en este backend —correo,
 * teléfono, documento y sus hashes— viaja siempre como cadena.
 */
export function redactSqlLiterals(statement: string): string {
  // El patrón admite la comilla duplicada (`''`), que es como SQL escapa una comilla dentro de
  // un literal: sin contemplarla, un literal con apóstrofo partiría la sustitución en dos y
  // dejaría fuera un trozo del valor.
  const withoutStrings = statement.replace(/'(?:[^']|'')*'/g, "'?'");
  // Bloques con delimitador en dólar (`$$…$$`, `$tag$…$tag$`): poco frecuentes en Sequelize,
  // pero pueden llevar cuerpos enteros de función o de JSON.
  const withoutDollarQuoted = withoutStrings.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1?\$/g, '$?$');
  return truncate(collapseWhitespace(withoutDollarQuoted));
}

/** Una sentencia de Sequelize llega con saltos de línea y sangría; en un atributo sólo estorban. */
function collapseWhitespace(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim();
}

function truncate(statement: string): string {
  if (statement.length <= MAX_STATEMENT_LENGTH) return statement;
  return `${statement.slice(0, MAX_STATEMENT_LENGTH - TRUNCATION_MARK.length)}${TRUNCATION_MARK}`;
}
