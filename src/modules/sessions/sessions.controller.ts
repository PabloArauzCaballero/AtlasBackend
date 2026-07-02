import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { SessionsService } from './sessions.service.js';
import {
  EndSessionDto,
  OperationSessionParamsDto,
  SessionHeartbeatDto,
  SessionParamsDto,
  StartSessionDto,
  StartSessionParamsDto,
  endSessionSchema,
  operationSessionParamsSchema,
  sessionHeartbeatSchema,
  sessionParamsSchema,
  startSessionParamsSchema,
  startSessionSchema,
} from './sessions.schemas.js';

type RequestWithNetwork = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function userAgentFrom(request: RequestWithNetwork): string | null {
  return firstHeader(request.headers['user-agent']);
}

@ApiTags('sessions')
@Controller('customers/:customerId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class CustomerSessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post('sessions/start')
  @HttpCode(HttpStatus.CREATED)
  startSession(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(startSessionParamsSchema)) params: StartSessionParamsDto,
    @Body(new ZodValidationPipe(startSessionSchema)) body: StartSessionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.sessionsService.startSession({
      customerId: params.customerId,
      body,
      currentUser,
      context: {
        tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
        ipAddress: request.ip ?? null,
        userAgent: userAgentFrom(request),
        idempotencyKey,
      },
    });
  }

  @Post('sessions/:sessionId/heartbeat')
  @HttpCode(HttpStatus.ACCEPTED)
  heartbeat(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(sessionParamsSchema)) params: SessionParamsDto,
    @Body(new ZodValidationPipe(sessionHeartbeatSchema)) body: SessionHeartbeatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.sessionsService.heartbeat({
      customerId: params.customerId,
      sessionId: params.sessionId,
      body,
      currentUser,
      context: {
        tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
        ipAddress: request.ip ?? null,
        userAgent: userAgentFrom(request),
        idempotencyKey,
      },
    });
  }

  @Post('sessions/:sessionId/end')
  @HttpCode(HttpStatus.OK)
  endSession(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(sessionParamsSchema)) params: SessionParamsDto,
    @Body(new ZodValidationPipe(endSessionSchema)) body: EndSessionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.sessionsService.endSession({
      customerId: params.customerId,
      sessionId: params.sessionId,
      body,
      currentUser,
      context: {
        tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
        ipAddress: request.ip ?? null,
        userAgent: userAgentFrom(request),
        idempotencyKey,
      },
    });
  }

  @Get('session-state')
  getSessionState(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(startSessionParamsSchema)) params: StartSessionParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.sessionsService.getSessionState({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      customerId: params.customerId,
      currentUser,
    });
  }
}

@Controller('operations/sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class OperationsSessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get(':sessionId/investigation-summary')
  getInvestigationSummary(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(operationSessionParamsSchema)) params: OperationSessionParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.sessionsService.getOperationsSessionSummary({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      sessionId: params.sessionId,
      currentUser,
    });
  }
}
