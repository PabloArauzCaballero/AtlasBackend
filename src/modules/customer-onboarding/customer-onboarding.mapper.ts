import { CustomerModel, CustomerSessionModel, DeviceModel, OnboardingFlowModel } from '../../database/models/index.js';
import { StartOnboardingResponseDto } from './customer-onboarding.dtos.js';

export function toStartOnboardingResponse(input: {
  customer: CustomerModel;
  session: CustomerSessionModel;
  device: DeviceModel;
  onboardingFlow: OnboardingFlowModel;
}): StartOnboardingResponseDto {
  return {
    customerId: String(input.customer.id),
    customerCode: input.customer.customerCode,
    lifecycleStatus: input.customer.lifecycleStatus,
    onboardingFlowId: String(input.onboardingFlow.id),
    sessionId: String(input.session.id),
    deviceId: String(input.device.id),
    nextStep: 'verify_contact',
  };
}
