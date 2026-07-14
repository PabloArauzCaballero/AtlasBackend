import {
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerModel,
  CustomerProfileVersionModel,
  RiskAssessmentResultModel,
} from '../../database/models/index.js';
import { CustomerMeResponseDto, CustomerProfileResponseDto, CustomerResponseDto } from './customers.dtos.js';
import { toIsoOrNull } from '../../common/utils/dates/date.util.js';

function deriveNextStep(lifecycleStatus: string | null, contacts: CustomerContactMethodModel[]): string {
  if (lifecycleStatus === 'blocked') return 'blocked';
  if (lifecycleStatus === 'pending_review') return 'pending_review';
  if (lifecycleStatus === 'approved') return 'complete';

  const hasUnverifiedContact = contacts.some((c) => c.status === 'unverified' || c.status === null);
  if (hasUnverifiedContact) return 'verify_contact';

  return 'identity_capture';
}

export function toCustomerResponse(customer: CustomerModel): CustomerResponseDto {
  return {
    id: String(customer.id),
    tenantId: String(customer.tenantId),
    customerCode: customer.customerCode,
    customerUuid: customer.customerUuid,
    lifecycleStatus: customer.lifecycleStatus,
    primaryPhoneLast4: customer.primaryPhoneLast4,
    primaryEmailDomain: customer.primaryEmailDomain,
    currentProfileVersionId: customer.currentProfileVersionId === null ? null : String(customer.currentProfileVersionId),
    createdAt: customer.createdAtValue.toISOString(),
  };
}

export function toCustomerProfileResponse(profile: CustomerProfileVersionModel): CustomerProfileResponseDto {
  return {
    id: String(profile.id),
    firstName: profile.firstName,
    lastName: profile.lastName,
    fullNameNormalized: profile.fullNameNormalized,
    birthDate: profile.birthDate,
    preferredLanguage: profile.preferredLanguage,
    marketingOptIn: profile.marketingOptIn,
    validFrom: toIsoOrNull(profile.validFrom),
  };
}

export function toCustomerMeResponse(input: {
  customer: CustomerModel;
  profile: CustomerProfileVersionModel | null;
  contacts: CustomerContactMethodModel[];
  consents: CustomerConsentModel[];
  riskResult: RiskAssessmentResultModel | null;
}): CustomerMeResponseDto {
  const acceptedPurposeCodes = input.consents
    .filter((c) => c.granted === true)
    .map((c) => c.purposeCode)
    .filter((code): code is string => code !== null);

  const declinedPurposeCodes = input.consents
    .filter((c) => c.granted === false)
    .map((c) => c.purposeCode)
    .filter((code): code is string => code !== null);

  return {
    customer: {
      customerId: String(input.customer.id),
      customerCode: input.customer.customerCode,
      status: input.customer.lifecycleStatus,
      phoneLast4: input.customer.primaryPhoneLast4,
      emailDomain: input.customer.primaryEmailDomain,
    },
    profile: input.profile
      ? {
          firstName: input.profile.firstName,
          lastName: input.profile.lastName,
          birthDate: input.profile.birthDate,
          preferredLanguage: input.profile.preferredLanguage,
        }
      : null,
    // BLOCKED: onboarding_flows table not present in current schema.
    onboarding: null,
    contacts: input.contacts.map((c) => ({
      contactType: c.contactType,
      status: c.status,
      isPrimary: c.isPrimary,
      valueLast4: c.valueLast4,
    })),
    consents: {
      accepted: acceptedPurposeCodes,
      declined: declinedPurposeCodes,
    },
    risk: input.riskResult
      ? {
          latestDecision: input.riskResult.recommendedAction,
          latestRiskLevel: input.riskResult.riskLevel,
        }
      : null,
    nextStep: deriveNextStep(input.customer.lifecycleStatus, input.contacts),
  };
}
