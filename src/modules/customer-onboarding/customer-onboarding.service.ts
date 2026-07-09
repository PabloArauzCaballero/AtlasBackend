import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { StartOnboardingResponseDto } from './customer-onboarding.dtos.js';
import { CustomerAddressPackageService } from './application/customer-address-package.service.js';
import { CustomerContactVerificationService } from './application/customer-contact-verification.service.js';
import { CustomerIdentityPackageService } from './application/customer-identity-package.service.js';
import { CustomerOnboardingStartService } from './application/customer-onboarding-start.service.js';
import {
  AddressPackageDto,
  ContactVerificationRequestDto,
  ContactVerificationSubmitDto,
  IdentityPackageDto,
  StartOnboardingDto,
} from './customer-onboarding.schemas.js';

@Injectable()
export class CustomerOnboardingService {
  constructor(
    private readonly startService: CustomerOnboardingStartService,
    private readonly contactVerificationService: CustomerContactVerificationService,
    private readonly identityPackageService: CustomerIdentityPackageService,
    private readonly addressPackageService: CustomerAddressPackageService,
  ) {}

  startOnboarding(
    tenantId: string,
    input: StartOnboardingDto,
    ipAddress: string | null,
    idempotencyKey: string,
  ): Promise<StartOnboardingResponseDto> {
    return this.startService.startOnboarding(tenantId, input, ipAddress, idempotencyKey);
  }

  requestContactVerification(input: {
    tenantId: string;
    customerId: string;
    body: ContactVerificationRequestDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    return this.contactVerificationService.requestContactVerification(input);
  }

  submitContactVerification(input: {
    tenantId: string;
    customerId: string;
    body: ContactVerificationSubmitDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    return this.contactVerificationService.submitContactVerification(input);
  }

  submitIdentityPackage(input: {
    tenantId: string;
    customerId: string;
    body: IdentityPackageDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    return this.identityPackageService.submitIdentityPackage(input);
  }

  submitAddressPackage(input: {
    tenantId: string;
    customerId: string;
    body: AddressPackageDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    return this.addressPackageService.submitAddressPackage(input);
  }
}
