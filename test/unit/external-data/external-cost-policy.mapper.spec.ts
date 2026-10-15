import { describe, expect, it } from '@jest/globals';
import { mapCostPolicy } from '../../../src/modules/external-data/application/external-cost-policy.mapper.js';

describe('mapCostPolicy — proyección pública de la política de costo', () => {
  it('devuelve null cuando no hay política', () => {
    expect(mapCostPolicy(null as never)).toBeNull();
  });

  it('proyecta la política y normaliza allowedDecisionStagesJson ausente a []', () => {
    const mapped = mapCostPolicy({
      id: 1,
      providerId: 3,
      queryType: 'identity_check',
      unitCostAmount: '5.00',
      currency: 'BOB',
      costTier: 'HIGH',
      maxQueriesPerUserPerDay: 2,
      maxQueriesPerUserPerMonth: 10,
      maxQueriesGlobalPerDay: 100,
      allowedDecisionStagesJson: null,
      requiresManualApproval: true,
      requiresAdminRole: true,
      blockByDefault: true,
      cacheTtlSeconds: 3600,
      featureTtlSeconds: 7200,
      retryMaxAttempts: 4,
      retryBackoffSeconds: 2,
      active: true,
      activeFrom: null,
      activeTo: null,
    } as never);

    expect(mapped).toMatchObject({
      id: '1',
      providerId: '3',
      queryType: 'identity_check',
      costTier: 'HIGH',
      allowedDecisionStagesJson: [],
      requiresManualApproval: true,
      cacheTtlSeconds: 3600,
      retryMaxAttempts: 4,
    });
  });
});
