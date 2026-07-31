/**
 * @file DTOs: contrato estable de salida sin filtrar modelos de persistencia.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
export type CustomerResponseDto = {
  id: string;
  tenantId: string;
  customerCode: string | null;
  customerUuid: string | null;
  lifecycleStatus: string | null;
  primaryPhoneLast4: string | null;
  primaryEmailDomain: string | null;
  currentProfileVersionId: string | null;
  createdAt: string;
};

export type CustomerProfileResponseDto = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullNameNormalized: string | null;
  birthDate: string | null;
  preferredLanguage: string | null;
  marketingOptIn: boolean | null;
  validFrom: string | null;
};

export type CustomerMeResponseDto = {
  customer: {
    customerId: string;
    customerCode: string | null;
    status: string | null;
    phoneLast4: string | null;
    emailDomain: string | null;
  };
  profile: {
    firstName: string | null;
    lastName: string | null;
    birthDate: string | null;
    preferredLanguage: string | null;
  } | null;
  onboarding: {
    onboardingFlowId: string;
    flowVersion: string | null;
    completionStatus: string | null;
    startedAt: string | null;
    completedAt: string | null;
    abandonedAt: string | null;
  } | null;
  eligibility: {
    eligible: boolean;
    completionPercentage: number;
    blockerCodes: string[];
  };
  contacts: Array<{
    contactType: string | null;
    status: string | null;
    isPrimary: boolean | null;
    valueLast4: string | null;
  }>;
  consents: {
    accepted: string[];
    declined: string[];
  };
  risk: {
    latestDecision: string | null;
    latestRiskLevel: string | null;
  } | null;
  nextStep: string;
};
