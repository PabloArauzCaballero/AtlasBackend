import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import { SYSTEMS_OPS_GOVERNANCE_ROLES } from './systems-ops.constants.js';
import {
  reviewDecisionSchema,
  ReviewDecisionDto,
  systemsColumnParamsSchema,
  SystemsColumnParamsDto,
  systemsDataImpactParamsSchema,
  SystemsDataImpactParamsDto,
  systemsEndpointParamsSchema,
  SystemsEndpointParamsDto,
  systemsFieldImpactParamsSchema,
  SystemsFieldImpactParamsDto,
  systemsEntityParamsSchema,
  SystemsEntityParamsDto,
  systemsReviewQueueSchema,
  SystemsReviewQueueDto,
  systemsToolRequirementParamsSchema,
  SystemsToolRequirementParamsDto,
} from './systems-ops.schemas.js';
import { SystemsReviewService } from './systems-review.service.js';

@Controller('systems')
@SystemsOpsControllerSecurity()
export class SystemsReviewController {
  constructor(private readonly service: SystemsReviewService) {}

  @ApiOperation({ summary: 'Cola de revisión del catálogo interno' })
  @ApiQuery({ name: 'type', required: false, schema: zodObjectPropertySchemas(systemsReviewQueueSchema).type })
  @ApiQuery({ name: 'module', required: false, schema: zodObjectPropertySchemas(systemsReviewQueueSchema).module })
  @ApiQuery({ name: 'reviewStatus', required: false, schema: zodObjectPropertySchemas(systemsReviewQueueSchema).reviewStatus })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsReviewQueueSchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsReviewQueueSchema).limit })
  @ApiResponse({ status: 200, description: 'Cola de revisión paginada.' })
  @Get('review-queue')
  getReviewQueue(@Query(new ZodValidationPipe(systemsReviewQueueSchema)) query: SystemsReviewQueueDto) {
    return this.service.getReviewQueue(query);
  }

  @ApiOperation({ summary: 'Revisar (aprobar/rechazar) un endpoint catalogado' })
  @ApiParam({ name: 'endpointId', schema: zodToApiSchema(systemsEndpointParamsSchema.shape.endpointId) })
  @ApiBody({ schema: zodToApiSchema(reviewDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión de revisión aplicada.' })
  @ApiResponse({ status: 404, description: 'ENDPOINT_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @Patch('endpoints/:endpointId/review')
  reviewEndpoint(
    @Param(new ZodValidationPipe(systemsEndpointParamsSchema)) params: SystemsEndpointParamsDto,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reviewEndpoint(params.endpointId, body, user);
  }

  @ApiOperation({ summary: 'Revisar (aprobar/rechazar) un requisito de herramienta' })
  @ApiParam({ name: 'requirementId', schema: zodToApiSchema(systemsToolRequirementParamsSchema.shape.requirementId) })
  @ApiBody({ schema: zodToApiSchema(reviewDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión de revisión aplicada.' })
  @ApiResponse({ status: 404, description: 'TOOL_REQUIREMENT_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @Patch('tools/requirements/:requirementId/review')
  reviewToolRequirement(
    @Param(new ZodValidationPipe(systemsToolRequirementParamsSchema)) params: SystemsToolRequirementParamsDto,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reviewToolRequirement(params.requirementId, body, user);
  }

  @ApiOperation({ summary: 'Revisar (aprobar/rechazar) una entidad de datos' })
  @ApiParam({ name: 'entityId', schema: zodToApiSchema(systemsEntityParamsSchema.shape.entityId) })
  @ApiBody({ schema: zodToApiSchema(reviewDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión de revisión aplicada.' })
  @ApiResponse({ status: 404, description: 'DATA_ENTITY_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @Patch('data-entities/:entityId/review')
  reviewDataEntity(
    @Param(new ZodValidationPipe(systemsEntityParamsSchema)) params: SystemsEntityParamsDto,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reviewDataEntity(params.entityId, body, user);
  }

  @ApiOperation({ summary: 'Revisar (aprobar/rechazar) un impacto de datos' })
  @ApiParam({ name: 'impactId', schema: zodToApiSchema(systemsDataImpactParamsSchema.shape.impactId) })
  @ApiBody({ schema: zodToApiSchema(reviewDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión de revisión aplicada.' })
  @ApiResponse({ status: 404, description: 'DATA_IMPACT_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @Patch('impact/data/:impactId/review')
  reviewDataImpact(
    @Param(new ZodValidationPipe(systemsDataImpactParamsSchema)) params: SystemsDataImpactParamsDto,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reviewDataImpact(params.impactId, body, user);
  }

  @ApiOperation({ summary: 'Revisar (aprobar/rechazar) un impacto de campo' })
  @ApiParam({ name: 'fieldImpactId', schema: zodToApiSchema(systemsFieldImpactParamsSchema.shape.fieldImpactId) })
  @ApiBody({ schema: zodToApiSchema(reviewDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión de revisión aplicada.' })
  @ApiResponse({ status: 404, description: 'FIELD_IMPACT_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @Patch('impact/fields/:fieldImpactId/review')
  reviewFieldImpact(
    @Param(new ZodValidationPipe(systemsFieldImpactParamsSchema)) params: SystemsFieldImpactParamsDto,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reviewFieldImpact(params.fieldImpactId, body, user);
  }

  @ApiOperation({ summary: 'Revisar (aprobar/rechazar) una columna de datos' })
  @ApiParam({ name: 'columnId', schema: zodToApiSchema(systemsColumnParamsSchema.shape.columnId) })
  @ApiBody({ schema: zodToApiSchema(reviewDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Decisión de revisión aplicada.' })
  @ApiResponse({ status: 404, description: 'DATA_COLUMN_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @Patch('data-entities/columns/:columnId/review')
  reviewDataColumn(
    @Param(new ZodValidationPipe(systemsColumnParamsSchema)) params: SystemsColumnParamsDto,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reviewDataColumn(params.columnId, body, user);
  }
}
