import { CustomerModel, CustomerSessionModel, DeviceModel } from '../../database/models/index.js';
import { StartOnboardingResponseDto } from './customer-onboarding.dtos.js';

export function toStartOnboardingResponse(input: {
  customer: CustomerModel;
  session: CustomerSessionModel;
  device: DeviceModel;
}): StartOnboardingResponseDto {
  return {
    customerId: String(input.customer.id),
    customerCode: input.customer.customerCode,
    lifecycleStatus: input.customer.lifecycleStatus,
    // BLOCKED: onboarding_flows table not present in current models.
    // Document block in docs/progress/progress-report.md.
    onboardingFlowId: null,
    sessionId: String(input.session.id),
    deviceId: String(input.device.id),
    nextStep: 'verify_contact',
  };
}
