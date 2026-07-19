import { describe, expect, it } from '@jest/globals';
import { toRiskAssessmentResultResponse } from '../../../src/modules/risk/risk.mapper.js';

/** `toRiskAssessmentResultResponse`: normaliza ids/scores y las fechas/customerId null. */
describe('risk.mapper', () => {
  const base = {
    id: 1,
    tenantId: 2,
    riskAssessmentRunId: 3,
    customerId: 9,
    assessmentType: 'onboarding',
    recommendedAction: 'approve',
    riskLevel: 'low',
    scoreTotal: '12.5',
    fraudScore: '0.10',
    identityScore: null,
    deviceRiskScore: null,
    behaviorScore: null,
    contactabilityScore: null,
    consistencyScore: null,
    reasonCodesJson: ['a'],
    modelVersionCodeSnapshot: 'm',
    rulesetVersionCodeSnapshot: 'r',
    decidedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('mapea los scores (toNumberOrNull) y la fecha ISO', () => {
    const res = toRiskAssessmentResultResponse(base as never);
    expect(res).toMatchObject({ id: '1', tenantId: '2', customerId: '9', scoreTotal: 12.5, fraudScore: 0.1, identityScore: null, decidedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('normaliza customerId y decidedAt null', () => {
    const res = toRiskAssessmentResultResponse({ ...base, customerId: null, decidedAt: null } as never);
    expect(res.customerId).toBeNull();
    expect(res.decidedAt).toBeNull();
  });
});
