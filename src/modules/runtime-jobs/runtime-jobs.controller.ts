import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import {
  applyRetentionPoliciesSchema,
  expireStaleSessionsSchema,
  processOutboxSchema,
  processEventsSchema,
  recalculateDataQualitySchema,
  ApplyRetentionPoliciesDto,
  ExpireStaleSessionsDto,
  ProcessEventsDto,
  ProcessOutboxDto,
  RecalculateDataQualityDto,
} from './runtime-jobs.schemas.js';
import { RuntimeJobsService } from './runtime-jobs.service.js';

function requireHeaders(tenantIdHeader: string | undefined, idempotencyKey: string | undefined): string {
  if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
  return parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
}

@ApiTags('runtime-jobs')
@Controller('operations/jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'system')
export class RuntimeJobsController {
  constructor(private readonly service: RuntimeJobsService) {}

  @Post('process-outbox')
  @HttpCode(HttpStatus.OK)
  processOutbox(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(processOutboxSchema)) body: ProcessOutboxDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.processOutbox({ tenantId: requireHeaders(tenantIdHeader, idempotencyKey), body, currentUser });
  }

  @Post('process-events')
  @HttpCode(HttpStatus.OK)
  processEvents(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(processEventsSchema)) body: ProcessEventsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.processEvents({ tenantId: requireHeaders(tenantIdHeader, idempotencyKey), body, currentUser });
  }

  @Post('expire-stale-sessions')
  @HttpCode(HttpStatus.OK)
  expireStaleSessions(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(expireStaleSessionsSchema)) body: ExpireStaleSessionsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.expireStaleSessions({ tenantId: requireHeaders(tenantIdHeader, idempotencyKey), body, currentUser });
  }

  @Post('apply-retention-policies')
  @HttpCode(HttpStatus.OK)
  applyRetentionPolicies(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(applyRetentionPoliciesSchema)) body: ApplyRetentionPoliciesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.applyRetentionPolicies({ tenantId: requireHeaders(tenantIdHeader, idempotencyKey), body, currentUser });
  }

  @Post('recalculate-data-quality')
  @HttpCode(HttpStatus.OK)
  recalculateDataQuality(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(recalculateDataQualitySchema)) body: RecalculateDataQualityDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.recalculateDataQuality({ tenantId: requireHeaders(tenantIdHeader, idempotencyKey), body, currentUser });
  }
}
