import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { SessionsService } from './sessions.service.js';
import {
  createCustomerSessionSchema,
  CreateCustomerSessionDto,
  listCustomerSessionsQuerySchema,
  ListCustomerSessionsQueryDto,
  sessionCustomerIdParamsSchema,
  SessionCustomerIdParamsDto,
} from './sessions.schemas.js';

type RequestWithIp = {
  ip?: string;
};

@Controller('customers/:customerId/sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  createCustomerSession(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(sessionCustomerIdParamsSchema)) params: SessionCustomerIdParamsDto,
    @Body(new ZodValidationPipe(createCustomerSessionSchema)) body: CreateCustomerSessionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? currentUser.tenantId ?? ''), 'x-tenant-id');
    return this.sessionsService.createCustomerSession({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @Get()
  listCustomerSessions(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(sessionCustomerIdParamsSchema)) params: SessionCustomerIdParamsDto,
    @Query(new ZodValidationPipe(listCustomerSessionsQuerySchema)) query: ListCustomerSessionsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? currentUser.tenantId ?? ''), 'x-tenant-id');
    return this.sessionsService.listCustomerSessions({
      tenantId,
      customerId: params.customerId,
      query,
      currentUser,
    });
  }
}
