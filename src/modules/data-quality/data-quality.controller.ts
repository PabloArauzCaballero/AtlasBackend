import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
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
@ApiBearerAuth('access-token')
@Controller('operations/data-quality/issues')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
export class DataQualityController {
  constructor(private readonly service: DataQualityService) {}

  @ApiOperation({ summary: 'Listar issues de calidad de datos', description: 'severity resuelve contra data_quality_rules (vía join manual, no columna propia del issue).' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(dataQualityQuerySchema).status })
  @ApiQuery({ name: 'severity', required: false, schema: zodObjectPropertySchemas(dataQualityQuerySchema).severity })
  @ApiQuery({ name: 'entityType', required: false, schema: zodObjectPropertySchemas(dataQualityQuerySchema).entityType })
  @ApiQuery({ name: 'customerId', required: false, schema: zodObjectPropertySchemas(dataQualityQuerySchema).customerId })
  @ApiResponse({ status: 200, description: 'Lista paginada de issues.' })
  @Get()
  listIssues(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(dataQualityQuerySchema)) query: DataQualityQueryDto,
  ) {
    return this.service.listIssues(tenantIdFromHeader(tenantIdHeader), query);
  }

  @ApiOperation({ summary: 'Resolver/ignorar un issue de calidad de datos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'issueId', schema: zodToApiSchema(dataQualityIssueParamsSchema.shape.issueId) })
  @ApiBody({ schema: zodToApiSchema(resolveDataQualityIssueSchema) })
  @ApiResponse({ status: 200, description: 'Issue resuelto/ignorado.' })
  @ApiResponse({ status: 404, description: 'DATA_QUALITY_ISSUE_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'DATA_QUALITY_ISSUE_ALREADY_RESOLVED.' })
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
      tenantId: tenantIdFromHeader(tenantIdHeader),
      params,
      body,
      currentUser,
      idempotencyKey,
    });
  }
}
