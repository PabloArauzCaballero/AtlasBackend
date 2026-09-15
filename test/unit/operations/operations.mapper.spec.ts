import { describe, expect, it } from '@jest/globals';
import {
  toFraudWorkItem,
  toInvestigationSummaryResponse,
  toManualReviewWorkItem,
} from '../../../src/modules/operations/operations.mapper.js';

/** Mappers puros de `operations`: work-items y el resumen de investigación. Ramas null/opcionales. */
describe('operations.mapper', () => {
  it('toManualReviewWorkItem mapea (customerId null vs set, openedAt null)', () => {
    const base = {
      id: 3,
      caseCode: 'MR-1',
      priority: 'high',
      status: 'open',
      caseType: 'kyc',
      openedAt: null,
      createdAtValue: new Date('2026-01-01T00:00:00.000Z'),
    };
    expect(toManualReviewWorkItem({ ...base, customerId: 9 } as never)).toMatchObject({
      workItemType: 'manual_review',
      caseId: '3',
      customerId: '9',
      openedAt: null,
    });
    expect(toManualReviewWorkItem({ ...base, customerId: null } as never).customerId).toBeNull();
  });

  it('toFraudWorkItem mapea severidad/estado/patrón', () => {
    const res = toFraudWorkItem({
      id: 4,
      caseCode: 'FR-1',
      customerId: 9,
      severity: 'critical',
      caseStatus: 'investigating',
      patternDetected: 'velocity',
      openedAt: new Date('2026-01-02T00:00:00.000Z'),
      createdAtValue: new Date('2026-01-02T00:00:00.000Z'),
    } as never);
    expect(res).toMatchObject({
      workItemType: 'fraud',
      caseId: '4',
      priority: 'critical',
      status: 'investigating',
      reasonCode: 'velocity',
    });
  });

  it('toInvestigationSummaryResponse arma risk/profile con sus ramas null', () => {
    const customer = {
      id: 5,
      customerCode: 'C1',
      lifecycleStatus: 'approved',
      primaryPhoneLast4: '1',
      primaryEmailDomain: 'x',
      createdAtValue: new Date('2026-01-01T00:00:00.000Z'),
    };
    const withData = toInvestigationSummaryResponse({
      customer: customer as never,
      profile: { firstName: 'Ana', lastName: 'Paz', birthDate: '1990', preferredLanguage: 'es' } as never,
      contacts: [{ contactType: 'phone', status: 'verified', isPrimary: true, valueLast4: '1' }] as never,
      consents: [{ purposeCode: 'm', granted: true, grantedAt: new Date('2026-01-01T00:00:00.000Z'), revokedAt: null }] as never,
      latestRiskResult: {
        riskAssessmentRunId: 7,
        assessmentType: 'onboarding',
        recommendedAction: 'approve',
        riskLevel: 'low',
        fraudScore: '0.12',
        decidedAt: null,
      } as never,
      manualReviewCases: [{ id: 1, caseCode: 'MR', caseType: 'kyc', priority: 'high', status: 'open', openedAt: null }] as never,
      fraudCases: [{ id: 2, caseCode: 'FR', severity: 'low', caseStatus: 'open', openedAt: null }] as never,
      latestIdentityAttempt: null,
      /*
        La agenda «no disponible»: el mismo objeto degradado que arma el servicio cuando la
        lectura falla o la persona no dio el permiso. Se escribe entero y no con un `as never`
        porque es justo el contrato que esta prueba existe para fijar.
      */
      addressBook: {
        available: false,
        totalContacts: 0,
        uniqueRatio: 0,
        bolivianRatio: 0,
        referencesFoundInAddressBook: 0,
        riskMatches: 0,
      },
    });
    expect(withData.latestRiskAssessment).toMatchObject({ riskAssessmentRunId: '7', fraudScore: 0.12 });
    expect(withData.profile).toMatchObject({ firstName: 'Ana' });
    expect(withData.consents[0]).toMatchObject({ grantedAt: '2026-01-01T00:00:00.000Z', revokedAt: null });

    const withoutData = toInvestigationSummaryResponse({
      customer: customer as never,
      profile: null,
      contacts: [] as never,
      consents: [] as never,
      latestRiskResult: null,
      manualReviewCases: [] as never,
      fraudCases: [] as never,
      latestIdentityAttempt: null,
      /*
        La agenda «no disponible»: el mismo objeto degradado que arma el servicio cuando la
        lectura falla o la persona no dio el permiso. Se escribe entero y no con un `as never`
        porque es justo el contrato que esta prueba existe para fijar.
      */
      addressBook: {
        available: false,
        totalContacts: 0,
        uniqueRatio: 0,
        bolivianRatio: 0,
        referencesFoundInAddressBook: 0,
        riskMatches: 0,
      },
    });
    expect(withoutData.profile).toBeNull();
    expect(withoutData.latestRiskAssessment).toBeNull();
  });
});
