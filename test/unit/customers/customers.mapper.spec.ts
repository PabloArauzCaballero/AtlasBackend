import { describe, expect, it } from '@jest/globals';
import { toCustomerMeResponse, toCustomerProfileResponse, toCustomerResponse } from '../../../src/modules/customers/customers.mapper.js';

/**
 * Mappers puros de `customers`: transforman modelos a DTOs.
 *
 * `deriveNextStep` ya no vive aquí. Ramificaba sobre `pending_review` y `approved` —valores que
 * ningún componente del sistema escribía en `lifecycle_status`— y devolvía `identity_capture` por
 * defecto, de modo que un cliente que ya había enviado sus documentos recibía la instrucción de
 * volver a subirlos. Ahora el `nextStep` lo produce el evaluador de habilitación, que es el mismo
 * que decide si el cliente puede solicitar crédito: una sola fuente, imposible de contradecir.
 */
describe('customers.mapper', () => {
  const baseCustomer = {
    id: 5,
    tenantId: 1,
    customerCode: 'C1',
    customerUuid: 'uuid-1',
    lifecycleStatus: 'onboarding_in_progress',
    primaryPhoneLast4: '1234',
    primaryEmailDomain: 'x.com',
    currentProfileVersionId: 9,
    createdAtValue: new Date('2026-01-01T00:00:00.000Z'),
  };

  const baseAssessment = {
    eligible: false,
    lifecycleStatus: 'onboarding_in_progress',
    ruleVersion: 'eligibility-v1',
    sections: [],
    completionPercentage: 50,
    canSubmit: false,
    nextStep: 'financial_profile',
    blockers: [{ code: 'CONTACT_NOT_VERIFIED' }],
  } as never;

  it('toCustomerResponse mapea y normaliza currentProfileVersionId (null vs set)', () => {
    expect(toCustomerResponse(baseCustomer as never)).toMatchObject({
      id: '5',
      tenantId: '1',
      currentProfileVersionId: '9',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(toCustomerResponse({ ...baseCustomer, currentProfileVersionId: null } as never).currentProfileVersionId).toBeNull();
  });

  it('toCustomerProfileResponse mapea con validFrom -> ISO o null', () => {
    const withDate = toCustomerProfileResponse({ id: 2, firstName: 'Ana', validFrom: new Date('2026-02-01T00:00:00.000Z') } as never);
    expect(withDate).toMatchObject({ id: '2', firstName: 'Ana', validFrom: '2026-02-01T00:00:00.000Z' });
    expect(toCustomerProfileResponse({ id: 2, validFrom: null } as never).validFrom).toBeNull();
  });

  it('toCustomerMeResponse separa consentimientos aceptados/rechazados y mapea contactos', () => {
    const res = toCustomerMeResponse({
      customer: baseCustomer as never,
      profile: { firstName: 'Ana', lastName: 'Paz', birthDate: '1990-01-01', preferredLanguage: 'es' } as never,
      contacts: [{ contactType: 'phone', status: 'verified', isPrimary: true, valueLast4: '1234' }] as never,
      consents: [
        { granted: true, purposeCode: 'marketing' },
        { granted: false, purposeCode: 'profiling' },
        { granted: true, purposeCode: null }, // se descarta (code null)
      ] as never,
      riskResult: { recommendedAction: 'approve', riskLevel: 'low' } as never,
      onboardingFlow: null,
      assessment: baseAssessment,
    });
    expect(res.consents).toEqual({ accepted: ['marketing'], declined: ['profiling'] });
    expect(res.contacts).toHaveLength(1);
    expect(res.risk).toEqual({ latestDecision: 'approve', latestRiskLevel: 'low' });
  });

  it('toCustomerMeResponse deja profile/risk/onboarding en null cuando no vienen', () => {
    const res = toCustomerMeResponse({
      customer: baseCustomer as never,
      profile: null,
      contacts: [] as never,
      consents: [] as never,
      riskResult: null,
      onboardingFlow: null,
      assessment: baseAssessment,
    });
    expect(res.profile).toBeNull();
    expect(res.risk).toBeNull();
    expect(res.onboarding).toBeNull();
  });

  /**
   * Regresión de H3: `onboarding` estaba fijado en `null` con el comentario "onboarding_flows table
   * not present in current schema". La tabla existe desde el arranque del proyecto, se escribe en el
   * registro y la consultan tres servicios del módulo; el comentario quedó de una fase anterior y
   * nadie volvió a conectar el dato real con la respuesta.
   */
  it('expone el flujo de onboarding real y toma nextStep del evaluador de habilitación', () => {
    const res = toCustomerMeResponse({
      customer: baseCustomer as never,
      profile: null,
      contacts: [] as never,
      consents: [] as never,
      riskResult: null,
      onboardingFlow: {
        id: 77,
        flowVersion: 'v1',
        completionStatus: 'in_progress',
        startedAt: new Date('2026-03-01T00:00:00.000Z'),
        completedAt: null,
        abandonedAt: null,
      } as never,
      assessment: baseAssessment,
    });
    expect(res.onboarding).toEqual({
      onboardingFlowId: '77',
      flowVersion: 'v1',
      completionStatus: 'in_progress',
      startedAt: '2026-03-01T00:00:00.000Z',
      completedAt: null,
      abandonedAt: null,
    });
    expect(res.nextStep).toBe('financial_profile');
    expect(res.eligibility).toEqual({ eligible: false, completionPercentage: 50, blockerCodes: ['CONTACT_NOT_VERIFIED'] });
  });
});
