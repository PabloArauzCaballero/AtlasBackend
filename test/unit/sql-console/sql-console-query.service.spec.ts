import { describe, expect, it, jest } from '@jest/globals';
import { SqlConsoleQueryService } from '../../../src/modules/sql-console/sql-console-query.service.js';

/**
 * La consola SQL interna: lo que se puede leer, cómo se acota y qué se enmascara.
 *
 * Lo que se fija son las defensas que están en la BASE y no en el análisis léxico —`READ ONLY`, el
 * plazo, el `search_path`—, porque valen aunque el guard se equivocara; el enmascarado, que tiene
 * que ser el mismo que en el cuaderno para que elegir herramienta no sea un modo de esquivarlo; y
 * que un rechazo del guard llegue como 422 con su motivo y no como un 500 que obliga a adivinar.
 */

function montar(opciones: { filas?: Record<string, unknown>[]; plan?: unknown; explainFalla?: boolean } = {}) {
  const sentencias: string[] = [];
  const transaccion = { commit: jest.fn(async () => undefined), rollback: jest.fn(async () => undefined) };

  const sequelize = {
    transaction: jest.fn(async () => transaccion),
    query: jest.fn(async (sql: string) => {
      sentencias.push(sql);
      if (sql.startsWith('EXPLAIN')) {
        if (opciones.explainFalla) throw new Error('no se pudo planificar');
        return opciones.plan ?? [{ 'QUERY PLAN': [{ Plan: { 'Plan Rows': 12, 'Plan Width': 8, 'Total Cost': 3.5 } }] }];
      }
      if (sql.startsWith('SELECT * FROM (')) return opciones.filas ?? [];
      return [];
    }),
  };
  const readQuery = {
    getConnection: () => sequelize,
    select: jest.fn(async () => [{ nspname: 'customer' }, { nspname: 'raro"con"comillas' }]),
  };

  return { service: new SqlConsoleQueryService(readQuery as never), sequelize, sentencias, transaccion, readQuery };
}

const admin = { role: 'platform_admin' } as never;
const analista = { role: 'risk_analyst' } as never;

describe('SqlConsoleQueryService · validar sin ejecutar', () => {
  /*
   * Un `EXPLAIN` sin `ANALYZE` no lee una fila, así que se puede ofrecer ANTES de decidir: dice
   * cuánto costaría y qué relaciones tocaría. Es lo que permite avisar de un barrido completo antes
   * de lanzarlo, en vez de después.
   */
  it('planifica sin ejecutar y devuelve el coste y las relaciones', async () => {
    const { service, sentencias } = montar();

    const veredicto = await service.validate('SELECT * FROM customer.customers JOIN credit.loans ON true');

    expect(veredicto.valid).toBe(true);
    expect(veredicto.estimate?.estimatedRows).toBe(12);
    expect(veredicto.estimate?.estimatedBytes).toBe(96);
    expect(veredicto.estimate?.scannedRelations).toEqual(expect.arrayContaining(['customer.customers', 'credit.loans']));
    expect(sentencias.some((s) => s.startsWith('SELECT * FROM ('))).toBe(false);
  });

  /*
   * Que Postgres no pueda planificarla es una validación NEGATIVA, no un fallo de la petición: la
   * respuesta sigue siendo 200 con el motivo dentro, que es lo que la consola sabe pintar.
   */
  it('un plan que falla es una validación negativa, no un error', async () => {
    const { service } = montar({ explainFalla: true });

    const veredicto = await service.validate('SELECT 1');

    expect(veredicto.valid).toBe(false);
    expect(veredicto.violations[0].code).toBe('SQL_PLAN_FAILED');
  });

  it('lo que el guard rechaza no llega siquiera a planificarse', async () => {
    const { service, sentencias } = montar();

    const veredicto = await service.validate('DELETE FROM customer.customers');

    expect(veredicto.valid).toBe(false);
    expect(sentencias).toHaveLength(0);
  });
});

describe('SqlConsoleQueryService · ejecutar', () => {
  /*
   * Con un `Error` corriente Nest respondía 500 y el motivo exacto del guard moría en el camino:
   * quien escribía la consulta veía un fallo del servidor sin saber que le habían rechazado la
   * consulta ni por qué. Y un 500 es mentira: la petición se entendió y se decidió no atenderla.
   */
  it('un rechazo del guard es 422 con su motivo, no un 500', async () => {
    const { service } = montar();

    await expect(service.execute('DROP TABLE customer.customers', admin)).rejects.toMatchObject({
      status: 422,
      response: { violations: expect.any(Array) },
    });
  });

  /*
   * Las tres defensas viven en la BASE y por eso valen aunque el análisis léxico se equivocara:
   * `READ ONLY` hace que Postgres rechace cualquier escritura, el plazo corta un barrido eterno, y
   * el `search_path` acotado impide que un nombre sin calificar resuelva a otro esquema.
   */
  it('ejecuta en una transacción de sólo lectura, con plazo y search_path acotado', async () => {
    const { service, sentencias } = montar({ filas: [{ id: '1' }] });

    await service.execute('SELECT id FROM customer.customers', admin);

    expect(sentencias).toContain('SET TRANSACTION READ ONLY');
    expect(sentencias.some((s) => s.startsWith('SET LOCAL statement_timeout ='))).toBe(true);
    const path = sentencias.find((s) => s.startsWith('SET LOCAL search_path'));
    expect(path).toBeTruthy();
    // Los esquemas salen del catálogo del servidor y van entrecomillados: uno puede llamarse como
    // una palabra reservada, y una comilla interior cerraría el identificador.
    expect(path).toContain('"customer"');
    expect(path).toContain('"raro""con""comillas"');
    expect(path).not.toContain('pg_catalog');
  });

  /*
   * Se pide UNA fila más que el techo: es lo que distingue «hay exactamente mil» de «hay más de
   * mil». Sin esa fila extra, `truncated` sería siempre falso.
   */
  it('pide una fila de más para poder decir que hay más', async () => {
    const muchas = Array.from({ length: 1001 }, (_, i) => ({ id: String(i) }));
    const { service, sentencias } = montar({ filas: muchas });

    const resultado = await service.execute('SELECT id FROM customer.customers', admin);

    expect(sentencias.some((s) => s.includes('LIMIT 1001'))).toBe(true);
    expect(resultado.truncated).toBe(true);
    expect(resultado.rowCount).toBe(1000);
  });

  it('no marca truncado lo que cabe entero', async () => {
    const { service } = montar({ filas: [{ id: '1' }, { id: '2' }] });

    const resultado = await service.execute('SELECT id FROM customer.customers', admin);

    expect(resultado.truncated).toBe(false);
    expect(resultado.rowCount).toBe(2);
  });

  /*
   * Mismas políticas que el cuaderno: las dos pantallas leen la misma superficie, y que una
   * enmascarara y la otra no convertiría la elección de herramienta en un modo de esquivarlo.
   */
  it('enmascara para quien no puede revelar, y no para quien sí', async () => {
    const fila = [{ email: 'ana@correo.test', document_number: '1234567' }];

    const conAnalista = montar({ filas: fila });
    const deAnalista = await conAnalista.service.execute('SELECT email, document_number FROM customer.customers', analista);

    const conAdmin = montar({ filas: fila });
    const deAdmin = await conAdmin.service.execute('SELECT email, document_number FROM customer.customers', admin);

    expect(deAnalista.rows[0]).not.toEqual(deAdmin.rows[0]);
  });

  /* La consola pinta valores planos: una fecha o un objeto viajan como texto, no `[object Object]`. */
  it('normaliza fechas y objetos a texto, y conserva los nulos', async () => {
    const { service } = montar({
      filas: [{ cuando: new Date('2026-09-10T00:00:00.000Z'), datos: { a: 1 }, vacio: null, numero: 7, si: true }],
    });

    const resultado = await service.execute('SELECT cuando, datos, vacio, numero, si FROM customer.x', admin);

    expect(resultado.rows[0]).toEqual(['2026-09-10T00:00:00.000Z', '{"a":1}', null, 7, true]);
  });

  it('una consulta sin filas no revienta al componer las columnas', async () => {
    const { service } = montar({ filas: [] });

    const resultado = await service.execute('SELECT id FROM customer.customers', admin);

    expect(resultado.rowCount).toBe(0);
    expect(resultado.columns).toEqual([]);
    expect(resultado.rows).toEqual([]);
  });

  /* Si la consulta revienta, la transacción se deshace: dejarla abierta bloquearía la conexión. */
  it('deshace la transacción cuando la consulta falla', async () => {
    const { service, sequelize, transaccion } = montar();
    sequelize.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('EXPLAIN')) return [{ 'QUERY PLAN': [{ Plan: {} }] }];
      if (sql.startsWith('SELECT * FROM (')) throw new Error('timeout');
      return [];
    });

    await expect(service.execute('SELECT id FROM customer.customers', admin)).rejects.toThrow('timeout');
    expect(transaccion.rollback).toHaveBeenCalled();
    expect(transaccion.commit).not.toHaveBeenCalled();
  });

  /* El catálogo de esquemas se pregunta una vez por proceso: es estable y la consola se usa a ráfagas. */
  it('no vuelve a preguntar los esquemas en cada consulta', async () => {
    const { service, readQuery } = montar({ filas: [] });

    await service.execute('SELECT id FROM customer.customers', admin);
    await service.execute('SELECT id FROM customer.customers', admin);

    expect(readQuery.select).toHaveBeenCalledTimes(1);
  });
});
