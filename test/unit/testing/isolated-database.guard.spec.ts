/**
 * @file Prueba de la guarda de aislamiento de la base de integración (AT-002).
 * @business La guarda existe para que una suite destructiva no corra jamás contra una base real.
 * @system Casos: sin bandera, con nombre productivo, con nombre de prueba, con autorización nominal.
 */
import { describe, expect, it } from '@jest/globals';
import { assessDatabaseIsolation, requireIsolatedDatabase } from '../../support/isolated-database.guard.js';

describe('assessDatabaseIsolation', () => {
  it('sin la bandera explícita rechaza aunque NODE_ENV sea test', () => {
    const verdict = assessDatabaseIsolation({ DB_NAME: 'atlas_test', NODE_ENV: 'test' });
    expect(verdict.allowed).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('ATLAS_TEST_DATABASE_ISOLATED=true') });
  });

  it('con nombre productivo rechaza aunque venga la bandera y la autorización', () => {
    const verdict = assessDatabaseIsolation({
      ATLAS_TEST_DATABASE_ISOLATED: 'true',
      ATLAS_TEST_DATABASE_NAME: 'atlas_prod',
      DB_NAME: 'atlas_prod',
    });
    expect(verdict.allowed).toBe(false);
  });

  it('con nombre que no parece de prueba y sin autorización nominal rechaza y explica cómo autorizar', () => {
    const verdict = assessDatabaseIsolation({ ATLAS_TEST_DATABASE_ISOLATED: 'true', DB_NAME: 'atlas' });
    expect(verdict.allowed).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('ATLAS_TEST_DATABASE_NAME=atlas') });
  });

  it('permite una base con «test» en el nombre cuando la bandera está presente', () => {
    expect(assessDatabaseIsolation({ ATLAS_TEST_DATABASE_ISOLATED: 'true', DB_NAME: 'atlas_test' })).toEqual({
      allowed: true,
      database: 'atlas_test',
    });
  });

  it('permite una base desechable autorizada nominalmente (el caso del job de CI)', () => {
    expect(assessDatabaseIsolation({ ATLAS_TEST_DATABASE_ISOLATED: 'true', ATLAS_TEST_DATABASE_NAME: 'atlas', DB_NAME: 'atlas' })).toEqual({
      allowed: true,
      database: 'atlas',
    });
  });

  it('sin DB_NAME rechaza: no se sabe contra qué correría', () => {
    expect(assessDatabaseIsolation({ ATLAS_TEST_DATABASE_ISOLATED: 'true' }).allowed).toBe(false);
  });
});

describe('requireIsolatedDatabase', () => {
  it('lanza con la causa cuando no está aislada y devuelve el nombre cuando sí', () => {
    expect(() => requireIsolatedDatabase({ DB_NAME: 'atlas_test' })).toThrow(/Base de pruebas no aislada/);
    expect(requireIsolatedDatabase({ ATLAS_TEST_DATABASE_ISOLATED: 'true', DB_NAME: 'atlas_test' })).toBe('atlas_test');
  });
});
