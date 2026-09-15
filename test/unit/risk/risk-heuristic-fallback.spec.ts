import { describe, expect, it } from '@jest/globals';
import { buildHeuristicFallback } from '../../../src/modules/risk/application/risk-heuristic-scoring.js';

/**
 * La heurística local ya NO aprueba a nadie.
 *
 * Medido en la base desplegada el 2026-09-14: cero evaluaciones de riesgo decididas por el Motor y
 * todas por este código, que con 65 puntos activaba al cliente sin política versionada. Degradar
 * es derivar a una persona y decir por qué; nunca conceder lo mismo que la política.
 */
describe('buildHeuristicFallback', () => {
  it('con puntaje sobrado sigue mandando a revisión, y dice que fue por falta de Motor', () => {
    expect(buildHeuristicFallback({ missing: [], totalScore: 95 })).toEqual({
      decision: 'manual_review_required',
      reasons: ['decision_engine_unavailable', 'heuristic_score_ok'],
    });
  });

  it('con puntaje bajo también, con el motivo honesto', () => {
    expect(buildHeuristicFallback({ missing: [], totalScore: 40 })).toEqual({
      decision: 'manual_review_required',
      reasons: ['decision_engine_unavailable', 'below_minimum_risk_score'],
    });
  });

  it('la evidencia que falta manda sobre el puntaje', () => {
    expect(buildHeuristicFallback({ missing: ['identity_document'], totalScore: 95 })).toEqual({
      decision: 'manual_review_required',
      reasons: ['missing_identity_document'],
    });
  });

  it('ninguna combinación devuelve approved_for_next_step', () => {
    for (const totalScore of [0, 64, 65, 66, 100]) {
      expect(buildHeuristicFallback({ missing: [], totalScore }).decision).not.toBe('approved_for_next_step');
    }
  });
});
