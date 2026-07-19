import { describe, expect, it } from '@jest/globals';
import { toCustomerMeResponse, toCustomerProfileResponse, toCustomerResponse } from '../../../src/modules/customers/customers.mapper.js';

/**
 * Mappers puros de `customers`: transforman modelos a DTOs. Alta densidad de ramas (null-coalescing,
 * split de consentimientos y la máquina de `nextStep`). Spec directo con objetos plano-modelo.
 */
describe('customers.mapper', () => {
  const baseCustomer = {
    id: 5,
    tenantId: 1,
    customerCode: 'C1',
    customerUuid: 'uuid-1',
    lifecycleStatus: 'approved',
    primaryPhoneLast4: '1234',
    primaryEmailDomain: 'x.com',
    currentProfileVersionId: 9,
    createdAtValue: new Date('2026-01-01T00:00:00.000Z'),
  };

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
    });
    expect(res.consents).toEqual({ accepted: ['marketing'], declined: ['profiling'] });
    expect(res.contacts).toHaveLength(1);
    expect(res.risk).toEqual({ latestDecision: 'approve', latestRiskLevel: 'low' });
    expect(res.nextStep).toBe('complete'); // lifecycleStatus 'approved'
  });

  it('toCustomerMeResponse deja profile/risk en null cuando no vienen', () => {
    const res = toCustomerMeResponse({
      customer: baseCustomer as never,
      profile: null,
      contacts: [] as never,
      consents: [] as never,
      riskResult: null,
    });
    expect(res.profile).toBeNull();
    expect(res.risk).toBeNull();
  });

  it('nextStep cubre todas las ramas de deriveNextStep', () => {
    const build = (lifecycleStatus: string, contacts: unknown[] = []) =>
      toCustomerMeResponse({
        customer: { ...baseCustomer, lifecycleStatus } as never,
        profile: null,
        contacts: contacts as never,
        consents: [] as never,
        riskResult: null,
      }).nextStep;
    expect(build('blocked')).toBe('blocked');
    expect(build('pending_review')).toBe('pending_review');
    expect(build('approved')).toBe('complete');
    expect(build('active', [{ status: 'unverified' }])).toBe('verify_contact');
    expect(build('active', [{ status: null }])).toBe('verify_contact');
    expect(build('active', [{ status: 'verified' }])).toBe('identity_capture');
  });
});
