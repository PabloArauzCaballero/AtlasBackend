/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza deja consultar los datos gobernados sin poder alterarlos ni extraer credenciales.
 * @system decide si una sentencia entra a la consola SQL y por qué motivo exacto se rechaza.
 */
import {
  SQL_ALLOWED_LEADING_KEYWORDS,
  SQL_CONSOLE_LIMITS,
  SQL_FORBIDDEN_FUNCTIONS,
  SQL_FORBIDDEN_KEYWORDS,
  SQL_FORBIDDEN_RELATIONS,
} from './sql-console.constants.js';
import { scanSql } from './sql-tokenizer.js';

export type SqlViolation = { code: string; message: string };

export type SqlGuardVerdict = { ok: true; statement: string } | { ok: false; violations: SqlViolation[] };

const FORBIDDEN_KEYWORDS = new Set<string>(SQL_FORBIDDEN_KEYWORDS);
const FORBIDDEN_FUNCTIONS = new Set<string>(SQL_FORBIDDEN_FUNCTIONS);
const FORBIDDEN_RELATIONS = new Set<string>(SQL_FORBIDDEN_RELATIONS);
const LEADING_KEYWORDS = new Set<string>(SQL_ALLOWED_LEADING_KEYWORDS);

const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const FIRST_PRINTABLE = 32;
const DELETE_CHARACTER = 127;

/**
 * Las puertas por las que pasa una consulta antes de llegar al pool.
 *
 * Ninguna es la única defensa —la ejecución va además en una transacción `READ ONLY`, con
 * `statement_timeout` y sobre el esquema `read_api`— y ésa es justamente la idea: si el análisis
 * léxico se equivoca, la base sigue negándose a escribir; si alguien reconfigura la conexión, el
 * análisis sigue negándose a enviar. Una capa fallando no basta para que ocurra un daño.
 *
 * Devuelve VIOLACIONES con código, no un booleano: la consola tiene que poder decir qué palabra
 * sobra. «Consulta no permitida» obliga a adivinar y termina con la gente probando variantes a
 * ciegas contra la base de producción.
 */
export function guardSqlStatement(input: string): SqlGuardVerdict {
  const raw = input.trim();
  const violations: SqlViolation[] = [];

  if (raw.length === 0) {
    return fail([{ code: 'SQL_EMPTY_STATEMENT', message: 'Escribe una consulta.' }]);
  }

  if (Buffer.byteLength(raw, 'utf8') > SQL_CONSOLE_LIMITS.maxStatementBytes) {
    return fail([
      {
        code: 'SQL_STATEMENT_TOO_LONG',
        message: `La consulta supera el máximo de ${SQL_CONSOLE_LIMITS.maxStatementBytes} bytes.`,
      },
    ]);
  }

  if (hasControlCharacter(raw)) {
    return fail([
      {
        code: 'SQL_CONTROL_CHARACTER',
        message: 'La consulta contiene caracteres de control que no se pueden ejecutar.',
      },
    ]);
  }

  const scan = scanSql(raw);

  if (scan.unterminated) {
    return fail([
      {
        code: 'SQL_UNTERMINATED',
        message:
          scan.unterminated === 'comment'
            ? 'Hay un comentario /* … */ sin cerrar.'
            : 'Hay una comilla sin cerrar: revisa los literales de texto.',
      },
    ]);
  }

  if (scan.statementCount > 1) {
    return fail([
      {
        code: 'SQL_MULTIPLE_STATEMENTS',
        message: 'Sólo se ejecuta UNA sentencia por consulta. Quita el punto y coma intermedio.',
      },
    ]);
  }

  const first = scan.words[0]?.value;
  if (!first || !LEADING_KEYWORDS.has(first)) {
    return fail([
      {
        code: 'SQL_NOT_A_QUERY',
        message: `Esta consola sólo lee: la sentencia debe empezar por ${formatList(SQL_ALLOWED_LEADING_KEYWORDS)}.`,
      },
    ]);
  }

  for (const word of scan.words) {
    if (word.followedBy === '(' && FORBIDDEN_FUNCTIONS.has(word.value)) {
      violations.push({
        code: 'SQL_FORBIDDEN_FUNCTION',
        message: `La función ${word.value}() no está disponible: lee fuera de las tablas, abre otra conexión o cambia el estado del servidor.`,
      });
    }

    // Un `.` delante lo descarta como calificador (`t.update`), donde la palabra es un nombre de
    // columna y no una orden.
    if (word.precededBy !== '.' && FORBIDDEN_KEYWORDS.has(word.value)) {
      violations.push({
        code: 'SQL_FORBIDDEN_KEYWORD',
        message: `La palabra «${word.value}» no se admite: la consola sólo lee. Si es el nombre de una columna, escríbelo entre comillas dobles ("${word.value}").`,
      });
    }

    if (FORBIDDEN_RELATIONS.has(word.value)) violations.push(relationViolation(word.value));
  }

  for (const identifier of scan.quotedIdentifiers) {
    if (FORBIDDEN_RELATIONS.has(identifier)) violations.push(relationViolation(identifier));
  }

  if (violations.length > 0) return fail(violations);
  return { ok: true, statement: scan.normalized };
}

/**
 * Se comprueba por código de carácter y no con una expresión regular a propósito: un byte nulo
 * dentro de una clase de caracteres es invisible al leer el archivo y sobrevive a un copiar y
 * pegar mal hecho. Tabulador, salto de línea y retorno son formato legítimo de una consulta
 * escrita a varias líneas; el resto trunca la cadena en algunos clientes de C, con lo que lo
 * validado y lo ejecutado dejarían de ser el mismo texto.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) continue;
    if (code < FIRST_PRINTABLE || code === DELETE_CHARACTER) return true;
  }
  return false;
}

function relationViolation(relation: string): SqlViolation {
  return {
    code: 'SQL_FORBIDDEN_RELATION',
    message: `La relación «${relation}» guarda credenciales o valores muestreados de otras tablas: no se sirve ni enmascarada.`,
  };
}

function fail(violations: SqlViolation[]): SqlGuardVerdict {
  return { ok: false, violations };
}

function formatList(values: readonly string[]): string {
  const upper = values.map((value) => value.toUpperCase());
  return `${upper.slice(0, -1).join(', ')} o ${upper[upper.length - 1]}`;
}
