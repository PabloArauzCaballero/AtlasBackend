import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { ConsentsService } from './consents.service.js';
import {
  consentCustomerIdParamsSchema,
  ConsentCustomerIdParamsDto,
  createCustomerConsentSchema,
  CreateCustomerConsentDto,
  listActiveConsentDocumentsQuerySchema,
  ListActiveConsentDocumentsQueryDto,
} from './consents.schemas.js';

type RequestWithIp = {
  ip?: string;
};

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @Public()
  @Get('consent-documents/active')
  listActiveDocuments(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listActiveConsentDocumentsQuerySchema)) query: ListActiveConsentDocumentsQueryDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.consentsService.listActiveDocuments(tenantId, query);
  }

  @Post('customers/:customerId/consents')
  recordCustomerConsent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(consentCustomerIdParamsSchema)) params: ConsentCustomerIdParamsDto,
    @Body(new ZodValidationPipe(createCustomerConsentSchema)) body: CreateCustomerConsentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? currentUser.tenantId ?? ''), 'x-tenant-id');
    return this.consentsService.recordCustomerConsent({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }
}
