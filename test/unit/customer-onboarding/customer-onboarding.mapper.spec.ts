import { describe, expect, it } from '@jest/globals';
import { ONBOARDING_SECTION_CODES } from '../../../src/modules/customers/customer-eligibility.constants.js';
import { toStartOnboardingResponse } from '../../../src/modules/customer-onboarding/customer-onboarding.mapper.js';

const tokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenType: 'Bearer' as const,
  expiresIn: '15m',
};

/** `toStartOnboardingResponse`: normaliza los ids del alta y fija el primer paso del catálogo. */
describe('customer-onboarding.mapper', () => {
  it('mapea customer/session/device/flow y fija nextStep', () => {
    const res = toStartOnboardingResponse({
      customer: { id: 9, customerCode: 'C1', lifecycleStatus: 'pending_review' } as never,
      session: { id: 2 } as never,
      device: { id: 3 } as never,
      onboardingFlow: { id: 4 } as never,
      tokens,
    });
    expect(res).toEqual({
      customerId: '9',
      customerCode: 'C1',
      lifecycleStatus: 'pending_review',
      onboardingFlowId: '4',
      sessionId: '2',
      deviceId: '3',
      nextStep: 'contact_verification',
      tokens,
    });
  });

  it('el primer paso sale del catálogo único de secciones, no de un literal por servicio', () => {
    const res = toStartOnboardingResponse({
      customer: { id: 1, customerCode: null, lifecycleStatus: 'pending_review' } as never,
      session: { id: 1 } as never,
      device: { id: 1 } as never,
      onboardingFlow: { id: 1 } as never,
      tokens,
    });
    expect(res.nextStep).toBe(ONBOARDING_SECTION_CODES[0]);
  });

  it('devuelve las credenciales de la sesión que abre el propio registro', () => {
    const res = toStartOnboardingResponse({
      customer: { id: 1, customerCode: null, lifecycleStatus: 'pending_review' } as never,
      session: { id: 1 } as never,
      device: { id: 1 } as never,
      onboardingFlow: { id: 1 } as never,
      tokens,
    });
    expect(res.tokens).toEqual(tokens);
  });
});
