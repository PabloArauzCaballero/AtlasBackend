import { describe, expect, it } from '@jest/globals';
import { scanSql } from '../../../src/modules/sql-console/sql-tokenizer.js';

/**
 * El tokenizador es la primera línea de la consola SQL gobernada: todo lo que el guardián prohíbe
 * se decide sobre lo que este archivo separa. Por eso lo que importa aquí no es "reconocer SQL",
 * sino los dos errores que un filtro por expresión regular comete siempre — disparar con una
 * consulta legítima que MENCIONA una palabra prohibida, y perderse la misma palabra escondida en un
 * comentario o en una cita rara de Postgres.
 */
describe('scanSql', () => {
  const valuesOf = (sql: string) => scanSql(sql).words.map((word) => word.value);

  it('separa palabras en minúsculas y no las busca dentro de los literales', () => {
    const scan = scanSql("SELECT * FROM auditoria WHERE accion = 'DELETE'");
    expect(scan.words.map((word) => word.value)).toEqual(['select', 'from', 'auditoria', 'where', 'accion']);
    expect(scan.unterminated).toBeNull();
  });

  it('delata la llamada a función por el paréntesis que sigue, y el calificador por el punto que precede', () => {
    const scan = scanSql('SELECT pg_sleep(1), t.update FROM t');
    const sleep = scan.words.find((word) => word.value === 'pg_sleep');
    const update = scan.words.find((word) => word.value === 'update');
    expect(sleep?.followedBy).toBe('(');
    expect(update?.precededBy).toBe('.');
  });

  describe('las cinco formas en que Postgres esconde texto', () => {
    it('ignora el comentario de línea', () => {
      expect(valuesOf('SELECT 1 -- DROP TABLE clientes\n')).toEqual(['select', '1']);
    });

    /** Los comentarios de bloque de Postgres ANIDAN: contar un solo cierre dejaría pasar el resto. */
    it('entiende que los comentarios de bloque ANIDAN', () => {
      expect(valuesOf('SELECT /* uno /* dos */ tres */ 1')).toEqual(['select', '1']);
    });

    it('no confunde el escape por duplicación con el fin del literal', () => {
      const scan = scanSql("SELECT 'no es'' el final; DROP' AS texto");
      expect(scan.statementCount).toBe(1);
      expect(valuesOf("SELECT 'no es'' el final; DROP' AS texto")).toEqual(['select', 'as', 'texto']);
    });

    /**
     * En `E'…'` la barra invertida escapa, así que `\'` NO cierra el literal: lo que sigue —incluido
     * un `DROP`— sigue siendo texto. La `E` sí es una palabra por sí misma; lo que no puede aparecer
     * es nada de lo que vive dentro de la cita.
     */
    it('respeta el escape con barra invertida de los literales E', () => {
      expect(valuesOf("SELECT E'\\' ; DROP TABLE t' AS texto")).toEqual(['select', 'e', 'as', 'texto']);
    });

    it('trata la cita con etiqueta ($tag$…$tag$) como un literal entero', () => {
      expect(valuesOf('SELECT $q$ ; DROP TABLE clientes $q$ AS texto')).toEqual(['select', 'as', 'texto']);
    });

    /** `$1` es un parámetro, no una cita: tratarlo como cita se comería el resto de la consulta. */
    it('no confunde un parámetro posicional con una cita con etiqueta', () => {
      expect(valuesOf('SELECT * FROM t WHERE id = $1')).toEqual(['select', 'from', 't', 'where', 'id', '$1']);
    });
  });

  describe('identificadores entre comillas', () => {
    it('los recoge en minúsculas para que la caja no sirva de disfraz', () => {
      expect(scanSql('SELECT * FROM "Pg_Authid"').quotedIdentifiers).toEqual(['pg_authid']);
    });

    it('deshace la comilla duplicada dentro del identificador', () => {
      expect(scanSql('SELECT * FROM "raro""nombre"').quotedIdentifiers).toEqual(['raro"nombre']);
    });
  });

  describe('conteo de sentencias', () => {
    it('un punto y coma final no abre una sentencia nueva', () => {
      expect(scanSql('SELECT 1;').statementCount).toBe(1);
      expect(scanSql('SELECT 1;   \n  ').statementCount).toBe(1);
    });

    it('cuenta dos cuando de verdad hay algo detrás', () => {
      expect(scanSql('SELECT 1; DROP TABLE clientes').statementCount).toBe(2);
    });

    it('no cuenta el punto y coma que vive dentro de un literal', () => {
      expect(scanSql("SELECT 'a;b'").statementCount).toBe(1);
    });
  });

  describe('texto sin cerrar', () => {
    it.each([
      ["SELECT 'abierto", 'string'],
      ['SELECT "abierto', 'identifier'],
      ['SELECT /* abierto', 'comment'],
      ['SELECT $q$ abierto', 'string'],
    ])('%s se reporta como %s', (sql, expected) => {
      expect(scanSql(sql).unterminated).toBe(expected);
    });
  });

  describe('normalizado', () => {
    it('es lo que llega a ejecutarse: sin comentarios, sin punto y coma final y con un solo espacio', () => {
      expect(scanSql('SELECT   1 /* nota */  FROM  t ;').normalized).toBe('SELECT 1 FROM t');
    });

    it('conserva el contenido de los literales tal cual', () => {
      expect(scanSql("SELECT 'a  b'").normalized).toBe("SELECT 'a b'");
    });
  });
});
