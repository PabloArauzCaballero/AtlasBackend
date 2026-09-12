import { describe, expect, it } from '@jest/globals';
import { recortarPorTamano } from '../../../src/modules/data-notebook/data-notebook-size.js';

/**
 * El techo de bytes no se ejercita solo: con los datos que hay hoy, 500 filas de la bitácora de
 * auditoría pesan 0,17 MB y el recorte nunca llega a dispararse. Un límite que no se recorre es un
 * límite del que nadie sabe si funciona hasta el día que hace falta, así que se prueba aquí con un
 * techo pequeño en vez de fabricar ocho megas de datos falsos.
 */
describe('recortarPorTamano', () => {
  const fila = (n: number) => ({ id: n, carga: 'x'.repeat(100) });

  it('deja pasar la página entera cuando cabe', () => {
    const recorte = recortarPorTamano([fila(1), fila(2)], 10_000);
    expect(recorte.rows).toHaveLength(2);
    expect(recorte.droppedRows).toBe(0);
    expect(recorte.bytes).toBeGreaterThan(0);
  });

  it('corta por filas ENTERAS y dice cuántas dejó fuera', () => {
    const filas = Array.from({ length: 20 }, (_, indice) => fila(indice));
    const recorte = recortarPorTamano(filas, 400);

    expect(recorte.rows.length).toBeLessThan(20);
    expect(recorte.droppedRows).toBe(20 - recorte.rows.length);
    expect(recorte.bytes).toBeLessThanOrEqual(400);
    // Cada fila servida sigue siendo un objeto completo: media fila no es JSON.
    for (const servida of recorte.rows) expect(Object.keys(servida)).toEqual(['id', 'carga']);
  });

  /**
   * Devolver cero filas por una fila gorda dejaría el dataset permanentemente vacío sin decir por
   * qué. Con una fila delante se puede ver al menos qué columna lo infla.
   */
  it('sirve la primera fila aunque ella sola supere el techo', () => {
    const recorte = recortarPorTamano([fila(1), fila(2)], 10);
    expect(recorte.rows).toHaveLength(1);
    expect(recorte.droppedRows).toBe(1);
    expect(recorte.bytes).toBeGreaterThan(10);
  });

  it('no falla con una página vacía', () => {
    expect(recortarPorTamano([], 1_000)).toEqual({ rows: [], bytes: 0, droppedRows: 0 });
  });
});
