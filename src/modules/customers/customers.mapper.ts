import { CustomerContactMethodModel, CustomerModel, CustomerProfileVersionModel } from '../../database/models/index.js';
import { CustomerProfileResponseDto, CustomerResponseDto, CustomerSummaryResponseDto } from './customers.dtos.js';

function toIsoOrNull(date: Date | string | null): string | null {
  if (date === null) {
    return null;
  }

  return date instanceof Date ? date.toISOString() : date;
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

export function toCustomerSummaryResponse(input: {
  customer: CustomerModel;
  profile: CustomerProfileVersionModel | null;
  contactMethods: CustomerContactMethodModel[];
}): CustomerSummaryResponseDto {
  return {
    customer: toCustomerResponse(input.customer),
    profile: input.profile ? toCustomerProfileResponse(input.profile) : null,
    contactMethods: input.contactMethods.map((contactMethod) => ({
      id: String(contactMethod.id),
      contactType: contactMethod.contactType,
      valueLast4: contactMethod.valueLast4,
      emailDomain: contactMethod.emailDomain,
      isPrimary: contactMethod.isPrimary,
      status: contactMethod.status,
    })),
  };
}
