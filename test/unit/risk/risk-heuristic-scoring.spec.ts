import { describe, expect, it } from '@jest/globals';
import { computeHeuristicScores } from '../../../src/modules/risk/application/risk-heuristic-scoring.js';
import { RISK_APPROVAL_MIN_SCORE } from '../../../src/modules/risk/risk-heuristic-v0.constants.js';

/**
 * El comportamiento del alta entra en el riesgo (plan F3, H-10) y SÓLO puede derivar a una persona.
 *
 * Hasta aquí `behavior_score` valía 50 para todos. Ahora sale del `botLikelihoodScore`; la propiedad que no se puede
 * perder es que un comportamiento «muy humano» no abra paso a quien antes iba a revisión.
 */
describe('computeHeuristicScores · comportamiento', () => {
  const combinaciones = [true, false].flatMap((hasIdentity) =>
    [0, 1].flatMap((verifiedContactCount) => [true, false].map((hasDevice) => ({ hasIdentity, verifiedContactCount, hasDevice }))),
  );

  it('sin bitácora sigue siendo 50 («no medido»)', () => {
    expect(computeHeuristicScores({ hasIdentity: true, verifiedContactCount: 1, hasDevice: true }).behaviorScore).toBe(50);
    expect(
      computeHeuristicScores({ hasIdentity: true, verifiedContactCount: 1, hasDevice: true, behaviorBotScore: null }).behaviorScore,
    ).toBe(50);
  });

  it('traduce el bot score a 100 × (1 − bot), acotado', () => {
    expect(
      computeHeuristicScores({ hasIdentity: true, verifiedContactCount: 1, hasDevice: true, behaviorBotScore: 0.25 }).behaviorScore,
    ).toBe(75);
    expect(computeHeuristicScores({ hasIdentity: true, verifiedContactCount: 1, hasDevice: true, behaviorBotScore: 3 }).behaviorScore).toBe(
      0,
    );
  });

  it.each(combinaciones)('nunca aprueba a quien sin comportamiento iba a revisión: %o', (base) => {
    const antes = computeHeuristicScores(base).totalScore >= RISK_APPROVAL_MIN_SCORE;
    const conLoMejor = computeHeuristicScores({ ...base, behaviorBotScore: 0 }).totalScore >= RISK_APPROVAL_MIN_SCORE;
    if (!antes) expect(conLoMejor).toBe(false);
  });

  it('un alta automatizada con todo lo demás en orden baja a revisión', () => {
    const base = { hasIdentity: true, verifiedContactCount: 1, hasDevice: true };
    expect(computeHeuristicScores(base).totalScore).toBeGreaterThanOrEqual(RISK_APPROVAL_MIN_SCORE);
    expect(computeHeuristicScores({ ...base, behaviorBotScore: 1 }).totalScore).toBeLessThan(RISK_APPROVAL_MIN_SCORE);
  });
});
