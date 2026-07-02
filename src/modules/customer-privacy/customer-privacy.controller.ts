import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { CustomerPrivacyService } from './customer-privacy.service.js';
import {
  consentDecisionsSchema,
  ConsentDecisionsDto,
  dataSubjectRequestSchema,
  DataSubjectRequestDto,
  privacyCustomerParamsSchema,
  PrivacyCustomerParamsDto,
} from './customer-privacy.schemas.js';

type RequestWithIp = { ip?: string };

@ApiTags('customer-privacy')
@Controller('customers/:customerId/privacy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'compliance_analyst', 'admin', 'platform_admin')
export class CustomerPrivacyController {
  constructor(private readonly privacyService: CustomerPrivacyService) {}

  @Post('consent-decisions')
  @HttpCode(HttpStatus.OK)
  registerConsentDecisions(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-client-channel') channel: string | undefined,
    @Param(new ZodValidationPipe(privacyCustomerParamsSchema)) params: PrivacyCustomerParamsDto,
    @Body(new ZodValidationPipe(consentDecisionsSchema)) body: ConsentDecisionsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.privacyService.registerConsentDecisions({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      customerId: params.customerId,
      body,
      currentUser,
      idempotencyKey,
      ipAddress: request.ip ?? null,
      channel: channel ?? 'mobile_app',
    });
  }

  @Post('data-subject-requests')
  @HttpCode(HttpStatus.CREATED)
  createDataSubjectRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(privacyCustomerParamsSchema)) params: PrivacyCustomerParamsDto,
    @Body(new ZodValidationPipe(dataSubjectRequestSchema)) body: DataSubjectRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.privacyService.createDataSubjectRequest({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      customerId: params.customerId,
      body,
      currentUser,
      idempotencyKey,
      ipAddress: request.ip ?? null,
    });
  }
}
