import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { CustomerOnboardingService } from './customer-onboarding.service.js';
import {
  addressPackageSchema,
  AddressPackageDto,
  contactVerificationRequestSchema,
  ContactVerificationRequestDto,
  contactVerificationSubmitSchema,
  ContactVerificationSubmitDto,
  identityPackageSchema,
  IdentityPackageDto,
  onboardingCustomerIdParamsSchema,
  OnboardingCustomerIdParamsDto,
  startOnboardingSchema,
  StartOnboardingDto,
} from './customer-onboarding.schemas.js';

type RequestWithIp = {
  ip?: string;
};

function requireIdempotencyKey(idempotencyKey: string | undefined): string {
  if (!idempotencyKey) {
    throw new BadRequestException('X-Idempotency-Key header is required.');
  }
  return idempotencyKey;
}

@ApiTags('customer-onboarding')
@Controller('customer-onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerOnboardingController {
  constructor(private readonly customerOnboardingService: CustomerOnboardingService) {}

  // 10 onboarding attempts per minute per IP — prevents enumeration and abuse
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Public()
  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  startOnboarding(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-client-channel') _channel: string | undefined,
    @Body(new ZodValidationPipe(startOnboardingSchema)) body: StartOnboardingDto,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.customerOnboardingService.startOnboarding(tenantId, body, request.ip ?? null, requireIdempotencyKey(idempotencyKey));
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @Post(':customerId/contact-verification/request')
  @HttpCode(HttpStatus.ACCEPTED)
  requestContactVerification(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(contactVerificationRequestSchema)) body: ContactVerificationRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.customerOnboardingService.requestContactVerification({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @Post(':customerId/contact-verification/submit')
  @HttpCode(HttpStatus.OK)
  submitContactVerification(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(contactVerificationSubmitSchema)) body: ContactVerificationSubmitDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.customerOnboardingService.submitContactVerification({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @Post(':customerId/identity-package')
  @HttpCode(HttpStatus.ACCEPTED)
  submitIdentityPackage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(identityPackageSchema)) body: IdentityPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.customerOnboardingService.submitIdentityPackage({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @Post(':customerId/address-package')
  @HttpCode(HttpStatus.OK)
  submitAddressPackage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(addressPackageSchema)) body: AddressPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.customerOnboardingService.submitAddressPackage({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }
}
