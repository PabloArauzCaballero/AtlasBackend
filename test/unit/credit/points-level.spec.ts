import { describe, expect, it } from '@jest/globals';
import { buildPointsLevel } from '../../../src/modules/credit/domain/points-level.js';

/** El nivel Atlas se mide en PUNTOS ganados pagando a tiempo, nunca en la calificación 1-100. */
describe('buildPointsLevel', () => {
  it.each([
    [0, 'NUEVO'],
    [499, 'NUEVO'],
    [500, 'EN_CONSTRUCCION'],
    [1_999, 'EN_CONSTRUCCION'],
    [2_000, 'ESTABLECIDO'],
    [5_000, 'CONSOLIDADO'],
    [9_999, 'CONSOLIDADO'],
    [10_000, 'PREFERENTE'],
  ])('%i puntos → %s', (puntos, codigo) => {
    expect(buildPointsLevel(puntos).level.code).toBe(codigo);
  });

  it('dice cuántos puntos faltan para el siguiente nivel', () => {
    const r = buildPointsLevel(24);
    expect(r.level).toMatchObject({ code: 'NUEVO', points: 24, index: 1, of: 5 });
    expect(r.nextLevel).toEqual({ code: 'EN_CONSTRUCCION', label: 'En construcción', from: 500, pointsMissing: 476 });
  });

  it('en el último nivel no hay siguiente y toda la escalera está alcanzada', () => {
    const r = buildPointsLevel(25_000);
    expect(r.nextLevel).toBeNull();
    expect(r.levelLadder.every((e) => e.reached)).toBe(true);
  });

  it('la escalera marca sólo los escalones alcanzados', () => {
    expect(buildPointsLevel(2_000).levelLadder.map((e) => e.reached)).toEqual([true, true, true, false, false]);
  });

  it.each([[-10], [Number.NaN], [Number.POSITIVE_INFINITY]])('un valor inválido (%p) cuenta como 0 puntos', (v) => {
    expect(buildPointsLevel(v).level).toMatchObject({ code: 'NUEVO', points: 0 });
  });

  it('los decimales no suben de nivel: 499,9 sigue en Nuevo', () => {
    expect(buildPointsLevel(499.9).level.code).toBe('NUEVO');
  });
});
