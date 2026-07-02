import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { DataQualityService } from './data-quality.service.js';
import {
  dataQualityIssueParamsSchema,
  DataQualityIssueParamsDto,
  dataQualityQuerySchema,
  DataQualityQueryDto,
  resolveDataQualityIssueSchema,
  ResolveDataQualityIssueDto,
} from './data-quality.schemas.js';

@ApiTags('data-quality')
@Controller('operations/data-quality/issues')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
export class DataQualityController {
  constructor(private readonly service: DataQualityService) {}

  @Get()
  listIssues(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(dataQualityQuerySchema)) query: DataQualityQueryDto,
  ) {
    return this.service.listIssues(parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'), query);
  }

  @Post(':issueId/resolve')
  @HttpCode(HttpStatus.OK)
  resolveIssue(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(dataQualityIssueParamsSchema)) params: DataQualityIssueParamsDto,
    @Body(new ZodValidationPipe(resolveDataQualityIssueSchema)) body: ResolveDataQualityIssueDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.service.resolveIssue({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      params,
      body,
      currentUser,
      idempotencyKey,
    });
  }
}
