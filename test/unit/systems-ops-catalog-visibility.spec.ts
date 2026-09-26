/**
 * @file El refresco del catálogo no depreca lo que no pudo ver.
 * @business Una columna marcada «obsoleta» sale de la documentación con la que los equipos deciden.
 *   Marcarla porque el proceso no tenía permiso para verla —y no porque haya dejado de existir—
 *   convierte el catálogo en una fuente que miente con seguridad, y nadie lo nota: se ve igual que
 *   uno correcto.
 * @system La introspección lee `information_schema`, que sólo muestra los objetos sobre los que el
 *   rol conectado tiene privilegios: con una identidad estrecha la consulta NO falla, devuelve
 *   menos. `readCatalogVisibility` lo mide contra `pg_catalog` (que no filtra) y `seesEverything`
 *   decide. Aquí se fija la decisión y que la consulta pregunte por privilegio real, no por catálogo.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { readCatalogVisibility, seesEverything, type CatalogVisibility } from '../../src/modules/systems-ops/catalog-visibility.util.js';

function sequelizeFalso(fila: CatalogVisibility | undefined, registro: string[]) {
  return {
    query: jest.fn(async (sql: string) => {
      registro.push(sql);
      return fila ? [fila] : [];
    }),
  } as never;
}

describe('visibilidad del catálogo de sistemas', () => {
  it('ver TODAS las tablas es la única condición que autoriza deprecar', () => {
    expect(seesEverything({ reachable: 201, existing: 201 })).toBe(true);
    // Ver de menos es el caso peligroso: lo no visto se confundiría con lo inexistente.
    expect(seesEverything({ reachable: 2, existing: 201 })).toBe(false);
    expect(seesEverything({ reachable: 200, existing: 201 })).toBe(false);
  });

  it('una base sin tablas NO autoriza deprecar: no hay nada contra lo que comparar', () => {
    expect(seesEverything({ reachable: 0, existing: 0 })).toBe(false);
  });

  it('pregunta por privilegio efectivo sobre el OID y cuenta sobre pg_catalog, que no filtra', async () => {
    const registro: string[] = [];
    const visibilidad = await readCatalogVisibility(sequelizeFalso({ reachable: 5, existing: 7 }, registro), ['iam', 'credit']);
    expect(visibilidad).toEqual({ reachable: 5, existing: 7 });
    const sql = registro[0];
    expect(sql).toContain('pg_class');
    expect(sql).toContain('has_table_privilege');
    // Por OID y no por nombre: resolver `schema.tabla` sin USAGE en ese schema lanzaría excepción.
    expect(sql).toContain('c.oid');
    expect(sql).not.toContain('information_schema');
  });

  it('si la consulta no devuelve fila, se asume ceguera: cero alcanzadas, cero existentes', async () => {
    const visibilidad = await readCatalogVisibility(sequelizeFalso(undefined, []), ['iam']);
    expect(visibilidad).toEqual({ reachable: 0, existing: 0 });
    expect(seesEverything(visibilidad)).toBe(false);
  });
});
