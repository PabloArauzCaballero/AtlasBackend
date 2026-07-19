import { describe, expect, it } from '@jest/globals';
import { toStartOnboardingResponse } from '../../../src/modules/customer-onboarding/customer-onboarding.mapper.js';

/** `toStartOnboardingResponse`: normaliza los ids del alta y fija nextStep = verify_contact. */
describe('customer-onboarding.mapper', () => {
  it('mapea customer/session/device/flow y fija nextStep', () => {
    const res = toStartOnboardingResponse({
      customer: { id: 9, customerCode: 'C1', lifecycleStatus: 'pending_review' } as never,
      session: { id: 2 } as never,
      device: { id: 3 } as never,
      onboardingFlow: { id: 4 } as never,
    });
    expect(res).toEqual({
      customerId: '9',
      customerCode: 'C1',
      lifecycleStatus: 'pending_review',
      onboardingFlowId: '4',
      sessionId: '2',
      deviceId: '3',
      nextStep: 'verify_contact',
    });
  });
});
