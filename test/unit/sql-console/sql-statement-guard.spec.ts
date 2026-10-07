import { describe, expect, it } from '@jest/globals';
import { guardSqlStatement } from '../../../src/modules/sql-console/sql-statement-guard.js';
import { SQL_CONSOLE_LIMITS } from '../../../src/modules/sql-console/sql-console.constants.js';

/**
 * La puerta de entrada de la consola SQL gobernada.
 *
 * No es la única defensa —la ejecución va en una transacción `READ ONLY`, con `statement_timeout` y
 * sobre `read_api`—, pero es la que decide QUÉ llega al pool y, sobre todo, la que tiene que
 * explicar por qué rechaza. Un «consulta no permitida» genérico termina con la gente probando
 * variantes a ciegas contra producción, así que el contrato incluye el código de cada violación.
 */
describe('guardSqlStatement', () => {
  const codesOf = (sql: string) => {
    const verdict = guardSqlStatement(sql);
    return verdict.ok ? [] : verdict.violations.map((violation) => violation.code);
  };

  describe('lo que sí entra', () => {
    it.each(['SELECT 1', 'select 1', 'WITH t AS (SELECT 1) SELECT * FROM t', 'TABLE read_api.clientes', 'VALUES (1)'])(
      'admite %s',
      (sql) => {
        expect(guardSqlStatement(sql).ok).toBe(true);
      },
    );

    it('devuelve la sentencia normalizada, que es exactamente lo que se ejecutará', () => {
      const verdict = guardSqlStatement('SELECT   1 /* nota */ FROM read_api.clientes ;');
      expect(verdict).toEqual({ ok: true, statement: 'SELECT 1 FROM read_api.clientes' });
    });

    /** `updated_at` contiene «update»: una búsqueda por subcadena rechazaría una columna legítima. */
    it('no confunde una columna que CONTIENE una palabra prohibida', () => {
      expect(guardSqlStatement('SELECT updated_at FROM read_api.clientes').ok).toBe(true);
    });

    /** Con un punto delante, la palabra es el nombre de una columna y no una orden. */
    it('admite una palabra prohibida usada como calificador de tabla', () => {
      expect(guardSqlStatement('SELECT t.update FROM read_api.t AS t').ok).toBe(true);
    });

    it('una palabra prohibida dentro de un literal no es una orden', () => {
      expect(guardSqlStatement("SELECT * FROM read_api.auditoria WHERE accion = 'delete'").ok).toBe(true);
    });
  });

  describe('lo que se rechaza antes de mirar el contenido', () => {
    it('exige una consulta', () => {
      expect(codesOf('   ')).toEqual(['SQL_EMPTY_STATEMENT']);
    });

    it('corta por tamaño antes de tokenizar', () => {
      const enorme = `SELECT '${'a'.repeat(SQL_CONSOLE_LIMITS.maxStatementBytes)}'`;
      expect(codesOf(enorme)).toEqual(['SQL_STATEMENT_TOO_LONG']);
    });

    /**
     * Un byte nulo es invisible al leer y trunca la cadena en algunos clientes: lo validado y lo
     * ejecutado dejarían de ser el mismo texto. El salto de línea, en cambio, es formato legítimo.
     */
    it('rechaza caracteres de control, y acepta los saltos de línea de una consulta con formato', () => {
      expect(codesOf('SELECT 1 \u0000 FROM t')).toEqual(['SQL_CONTROL_CHARACTER']);
      expect(guardSqlStatement('SELECT 1\n  FROM read_api.t').ok).toBe(true);
    });

    it.each(["SELECT 'abierto", 'SELECT /* abierto'])('rechaza el texto sin cerrar: %s', (sql) => {
      expect(codesOf(sql)).toEqual(['SQL_UNTERMINATED']);
    });

    it('rechaza dos sentencias en un mismo envío', () => {
      expect(codesOf('SELECT 1; DROP TABLE clientes')).toEqual(['SQL_MULTIPLE_STATEMENTS']);
    });

    it.each(['DELETE FROM clientes', 'EXPLAIN SELECT 1', 'GRANT ALL ON t TO alguien'])(
      'rechaza lo que no empieza por una palabra de lectura: %s',
      (sql) => {
        expect(codesOf(sql)).toEqual(['SQL_NOT_A_QUERY']);
      },
    );
  });

  describe('lo que se rechaza por su contenido', () => {
    it('nombra la palabra prohibida en vez de decir «no permitida»', () => {
      const verdict = guardSqlStatement('SELECT 1 FROM t UNION SELECT drop');
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.violations[0].code).toBe('SQL_FORBIDDEN_KEYWORD');
        expect(verdict.violations[0].message).toContain('drop');
      }
    });

    it('rechaza las funciones que leen fuera de las tablas o abren otra conexión', () => {
      expect(codesOf("SELECT pg_read_file('/etc/passwd')")).toContain('SQL_FORBIDDEN_FUNCTION');
    });

    it('rechaza las relaciones con credenciales o valores muestreados de otras tablas', () => {
      expect(codesOf('SELECT * FROM pg_authid')).toContain('SQL_FORBIDDEN_RELATION');
    });

    /** Entrecomillar el nombre no lo disfraza: el tokenizador entrega el identificador en minúsculas. */
    it('rechaza esa relación aunque se escriba entre comillas y con otra caja', () => {
      expect(codesOf('SELECT * FROM "Pg_Authid"')).toContain('SQL_FORBIDDEN_RELATION');
    });

    it('acumula todas las violaciones, no sólo la primera', () => {
      const codes = codesOf('SELECT pg_read_file(1), drop FROM pg_authid');
      expect(new Set(codes)).toEqual(new Set(['SQL_FORBIDDEN_FUNCTION', 'SQL_FORBIDDEN_KEYWORD', 'SQL_FORBIDDEN_RELATION']));
    });

    /** Postgres decodifica `U&"…"` antes de resolver el nombre: comparar el texto crudo no sirve. */
    it('rechaza los escapes Unicode, que disfrazan la relación o la función', () => {
      expect(codesOf('SELECT password_hash FROM iam.U&"auth\\005fcredentials"')).toContain('SQL_UNICODE_ESCAPE');
      expect(codesOf("SELECT U&'a'")).toContain('SQL_UNICODE_ESCAPE');
    });

    it('rechaza la función aunque se llame entre comillas', () => {
      expect(codesOf(`SELECT "set_config"('statement_timeout','0',true)`)).toContain('SQL_FORBIDDEN_FUNCTION');
      expect(codesOf(`SELECT "PG_READ_FILE"('/etc/passwd')`)).toContain('SQL_FORBIDDEN_FUNCTION');
    });

    it('rechaza los códigos de un solo uso y las estadísticas de columna', () => {
      expect(codesOf('SELECT code_hash FROM iam.auth_one_time_codes')).toContain('SQL_FORBIDDEN_RELATION');
      expect(codesOf('SELECT most_common_vals FROM pg_stats')).toContain('SQL_FORBIDDEN_RELATION');
    });

    it('sin baseSchemas sólo se lee read_api, también entre comillas', () => {
      expect(codesOf('SELECT email AS e FROM customer.customers')).toContain('SQL_BASE_SCHEMA');
      expect(codesOf('SELECT * FROM "customer"."customers"')).toContain('SQL_BASE_SCHEMA');
      expect(guardSqlStatement('SELECT email FROM customer.customers', { baseSchemas: true }).ok).toBe(true);
      expect(guardSqlStatement('SELECT * FROM read_api.customers').ok).toBe(true);
    });
  });
});
