/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza deja consultar los datos gobernados sin poder alterarlos ni extraer credenciales.
 * @system separa palabras, literales, identificadores y comentarios de una sentencia SQL.
 */

/** Una palabra desnuda de la sentencia (no un literal ni un identificador entrecomillado). */
export type SqlWord = {
  /** El token en minúsculas, listo para comparar contra las listas de prohibidos. */
  value: string;
  /** Qué carácter no-espacio venía justo después: `(` delata una llamada a función. */
  followedBy: string | null;
  /** Qué carácter no-espacio venía justo antes: `.` delata un calificador (`t.update`). */
  precededBy: string | null;
};

export type SqlScan = {
  words: SqlWord[];
  /** Identificadores entre comillas dobles, en minúsculas: `"Pg_Authid"` no debe escapar por la caja. */
  quotedIdentifiers: string[];
  /** Cuántas sentencias separa el texto: un `;` final no cuenta. */
  statementCount: number;
  /** Un literal o un comentario que nunca se cierra. */
  unterminated: 'string' | 'comment' | 'identifier' | null;
  /** El texto sin comentarios y sin el `;` final, que es lo que se llega a ejecutar. */
  normalized: string;
};

const WORD_CHARS = /[A-Za-z0-9_$]/;

/**
 * Recorre la sentencia una vez, entendiendo las cinco formas en que Postgres esconde texto.
 *
 * El motivo de tokenizar en vez de aplicar expresiones regulares sobre la cadena entera: cualquier
 * filtro que busque «delete» en el texto crudo se dispara con `SELECT * FROM auditoria WHERE accion
 * = 'delete'` —una consulta legítima— y a la vez se lo pierde escrito como `/**\/DELETE`. Separar
 * primero y comparar después elimina las dos clases de error de golpe.
 */
export function scanSql(sql: string): SqlScan {
  const words: SqlWord[] = [];
  const quotedIdentifiers: string[] = [];
  const normalizedParts: string[] = [];
  let statementCount = 1;
  let sawContentSinceSemicolon = false;
  let unterminated: SqlScan['unterminated'] = null;
  let index = 0;

  const previousChar = (at: number): string | null => {
    let cursor = at - 1;
    while (cursor >= 0 && /\s/.test(sql[cursor])) cursor -= 1;
    return cursor >= 0 ? sql[cursor] : null;
  };

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end + 1;
      normalizedParts.push(' ');
      continue;
    }

    if (char === '/' && next === '*') {
      // Los comentarios de bloque de Postgres ANIDAN: `/* /* */ */` sigue siendo un comentario.
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth > 0) unterminated = 'comment';
      normalizedParts.push(' ');
      continue;
    }

    if (char === "'") {
      const end = readSingleQuoted(sql, index);
      if (end === -1) {
        unterminated = 'string';
        break;
      }
      normalizedParts.push(sql.slice(index, end + 1));
      index = end + 1;
      sawContentSinceSemicolon = true;
      continue;
    }

    if (char === '"') {
      const end = readDoubleQuoted(sql, index);
      if (end === -1) {
        unterminated = 'identifier';
        break;
      }
      quotedIdentifiers.push(
        sql
          .slice(index + 1, end)
          .replace(/""/g, '"')
          .toLowerCase(),
      );
      normalizedParts.push(sql.slice(index, end + 1));
      index = end + 1;
      sawContentSinceSemicolon = true;
      continue;
    }

    if (char === '$') {
      const dollar = readDollarQuoted(sql, index);
      if (dollar) {
        if (dollar.end === -1) {
          unterminated = 'string';
          break;
        }
        normalizedParts.push(sql.slice(index, dollar.end));
        index = dollar.end;
        sawContentSinceSemicolon = true;
        continue;
      }
    }

    if (char === ';') {
      // Un `;` sólo separa si TODAVÍA queda algo detrás: `SELECT 1;` es una sentencia,
      // `SELECT 1; DROP …` son dos.
      if (sawContentSinceSemicolon && sql.slice(index + 1).trim().length > 0) statementCount += 1;
      sawContentSinceSemicolon = false;
      normalizedParts.push(' ');
      index += 1;
      continue;
    }

    if (WORD_CHARS.test(char)) {
      let end = index;
      while (end < sql.length && WORD_CHARS.test(sql[end])) end += 1;
      const raw = sql.slice(index, end);
      let cursor = end;
      while (cursor < sql.length && /\s/.test(sql[cursor])) cursor += 1;
      words.push({
        value: raw.toLowerCase(),
        followedBy: cursor < sql.length ? sql[cursor] : null,
        precededBy: previousChar(index),
      });
      normalizedParts.push(raw);
      index = end;
      sawContentSinceSemicolon = true;
      continue;
    }

    normalizedParts.push(char);
    if (!/\s/.test(char)) sawContentSinceSemicolon = true;
    index += 1;
  }

  return {
    words,
    quotedIdentifiers,
    statementCount,
    unterminated,
    normalized: normalizedParts.join('').replace(/\s+/g, ' ').trim().replace(/;+$/, '').trim(),
  };
}

/** Índice de la comilla que cierra, o -1. Postgres escapa duplicando (`''`), y `E'…'` con `\`. */
function readSingleQuoted(sql: string, start: number): number {
  const escapesWithBackslash = /[eE]$/.test(sql.slice(Math.max(0, start - 1), start));
  let index = start + 1;
  while (index < sql.length) {
    if (escapesWithBackslash && sql[index] === '\\') {
      index += 2;
      continue;
    }
    if (sql[index] === "'") {
      if (sql[index + 1] === "'") {
        index += 2;
        continue;
      }
      return index;
    }
    index += 1;
  }
  return -1;
}

function readDoubleQuoted(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === '"') {
      if (sql[index + 1] === '"') {
        index += 2;
        continue;
      }
      return index;
    }
    index += 1;
  }
  return -1;
}

/** `$tag$…$tag$`. Devuelve null si el `$` no abre una cita (p. ej. el parámetro `$1`). */
function readDollarQuoted(sql: string, start: number): { end: number } | null {
  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(start));
  if (!match) return null;
  const tag = match[0];
  const close = sql.indexOf(tag, start + tag.length);
  return { end: close === -1 ? -1 : close + tag.length };
}
