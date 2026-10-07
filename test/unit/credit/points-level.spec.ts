import { describe, expect, it } from '@jest/globals';
import { buildPointsLevel } from '../../../src/modules/credit/domain/points-level.js';

/** El nivel Atlas se mide en PUNTOS ganados pagando a tiempo, nunca en la calificación 1-100. */
describe('buildPointsLevel', () => {
  it.each([
    [0, 'NUEVO'],
    [99, 'NUEVO'],
    [100, 'NUEVO'],
    [499, 'NUEVO'],
    [500, 'EN_CONSTRUCCION'],
    [1_999, 'EN_CONSTRUCCION'],
    [2_000, 'ESTABLECIDO'],
    [5_000, 'CONSOLIDADO'],
    [9_999, 'CONSOLIDADO'],
    [10_000, 'PREFERENTE'],
    [50_000, 'PREFERENTE'],
  ])('%i puntos → escalón %s (el de la tarjeta no se movió)', (puntos, codigo) => {
    expect(buildPointsLevel(puntos).level.code).toBe(codigo);
  });

  it.each([
    [0, 'NUEVO', 1],
    [100, 'EXPLORADOR', 2],
    [500, 'EN_CONSTRUCCION', 3],
    [1_000, 'CONSTANTE', 4],
    [3_500, 'CONFIABLE', 6],
    [7_500, 'DESTACADO', 8],
    [15_000, 'ELITE', 10],
    [25_000, 'LEYENDA', 11],
    [50_000, 'TITAN', 12],
  ])('%i puntos → nivel %s (n.º %i de 12)', (puntos, id, indice) => {
    expect(buildPointsLevel(puntos).level).toMatchObject({ id, index: indice, of: 12 });
  });

  it('los niveles son crecientes y cada id es único', () => {
    const { levelLadder } = buildPointsLevel(0);
    expect(new Set(levelLadder.map((e) => e.id)).size).toBe(levelLadder.length);
    expect(levelLadder.map((e) => e.from)).toEqual([...levelLadder.map((e) => e.from)].sort((a, b) => a - b));
  });

  it('los cinco cortes originales siguen donde estaban', () => {
    const desde = (code: string) => buildPointsLevel(0).levelLadder.find((e) => e.id === code)!.from;
    expect([desde('NUEVO'), desde('EN_CONSTRUCCION'), desde('ESTABLECIDO'), desde('CONSOLIDADO'), desde('PREFERENTE')]).toEqual([
      0, 500, 2_000, 5_000, 10_000,
    ]);
  });

  it('dice cuántos puntos faltan para el siguiente nivel', () => {
    const r = buildPointsLevel(24);
    expect(r.level).toMatchObject({ id: 'NUEVO', code: 'NUEVO', points: 24, index: 1, of: 12 });
    expect(r.nextLevel).toEqual({ id: 'EXPLORADOR', code: 'NUEVO', label: 'Explorador', from: 100, pointsMissing: 76 });
  });

  it('en el último nivel no hay siguiente y toda la escalera está alcanzada', () => {
    const r = buildPointsLevel(80_000);
    expect(r.nextLevel).toBeNull();
    expect(r.levelLadder.every((e) => e.reached)).toBe(true);
  });

  it('la escalera marca sólo los escalones alcanzados', () => {
    expect(buildPointsLevel(2_000).levelLadder.map((e) => e.reached)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it.each([[-10], [Number.NaN], [Number.POSITIVE_INFINITY]])('un valor inválido (%p) cuenta como 0 puntos', (v) => {
    expect(buildPointsLevel(v).level).toMatchObject({ code: 'NUEVO', points: 0 });
  });

  it('los decimales no suben de nivel: 499,9 sigue en Nuevo', () => {
    expect(buildPointsLevel(499.9).level.code).toBe('NUEVO');
  });
});
