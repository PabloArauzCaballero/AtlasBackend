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

export type CustomerRegistrationResponseDto = {
  customer: CustomerResponseDto;
  profile: CustomerProfileResponseDto;
};

export type CustomerSummaryResponseDto = {
  customer: CustomerResponseDto;
  profile: CustomerProfileResponseDto | null;
  contactMethods: Array<{
    id: string;
    contactType: string | null;
    valueLast4: string | null;
    emailDomain: string | null;
    isPrimary: boolean | null;
    status: string | null;
  }>;
};
