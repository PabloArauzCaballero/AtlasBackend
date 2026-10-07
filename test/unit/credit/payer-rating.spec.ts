import { describe, expect, it } from '@jest/globals';
import { toPaymentPoints, toPayerRating } from '../../../src/modules/credit/domain/payer-rating.js';

/** La Calificación vive en 1-100: el borde de abajo es 1, no 0, y nada se sale de la escala. */
describe('toPayerRating', () => {
  it.each([
    [0, 1],
    [1, 1],
    [50.4, 50],
    [99.6, 100],
    [100, 100],
    [101, 100],
    [-5, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
  ])('puntuación %p → calificación %p', (entrada, esperado) => {
    expect(toPayerRating(entrada)).toEqual({ value: esperado, scale: { min: 1, max: 100 } });
  });
});

describe('toPaymentPoints', () => {
  it('el Puntaje son los XP ganados pagando, con sus rachas', () => {
    expect(toPaymentPoints({ xp: 1250, currentStreak: 3, bestStreak: 5 })).toEqual({ value: 1250, currentStreak: 3, bestStreak: 5 });
  });
});
