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
  onboarding: null;
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
