export type StartOnboardingResponseDto = {
  customerId: string;
  customerCode: string | null;
  lifecycleStatus: string | null;
  onboardingFlowId: string | null;
  sessionId: string;
  deviceId: string;
  nextStep: string;
};
