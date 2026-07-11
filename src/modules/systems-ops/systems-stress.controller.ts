import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import { SYSTEMS_OPS_STRESS_ROLES } from './systems-ops.constants.js';
import {
  queueStressRunSchema,
  QueueStressRunDto,
  systemsListQuerySchema,
  SystemsListQueryDto,
  systemsRunsQuerySchema,
  SystemsRunsQueryDto,
  systemsStressProfileParamsSchema,
  SystemsStressProfileParamsDto,
  systemsStressProfileQuerySchema,
  SystemsStressProfileQueryDto,
  upsertStressProfileSchema,
  UpsertStressProfileDto,
} from './systems-ops.schemas.js';
import { SystemsStressProfileService } from './systems-stress-profile.service.js';
import { SystemsStressRunService } from './systems-stress-run.service.js';

@Controller('systems')
@SystemsOpsControllerSecurity()
export class SystemsStressController {
  constructor(
    private readonly service: SystemsStressProfileService,
    private readonly stressRunService: SystemsStressRunService,
  ) {}

  @ApiOperation({ summary: 'Listar perfiles de pruebas de estrés' })
  @ApiQuery({ name: 'endpointId', required: false, schema: zodObjectPropertySchemas(systemsStressProfileQuerySchema).endpointId })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(systemsStressProfileQuerySchema).status })
  @ApiQuery({ name: 'enabled', required: false, schema: zodObjectPropertySchemas(systemsStressProfileQuerySchema).enabled })
  @ApiQuery({ name: 'q', required: false, schema: zodObjectPropertySchemas(systemsStressProfileQuerySchema).q })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsStressProfileQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsStressProfileQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de perfiles de estrés.' })
  @Get('stress-profiles')
  listStressProfiles(@Query(new ZodValidationPipe(systemsStressProfileQuerySchema)) query: SystemsStressProfileQueryDto) {
    return this.service.listStressProfiles(query);
  }

  @ApiOperation({ summary: 'Obtener un perfil de pruebas de estrés' })
  @ApiParam({ name: 'profileId', schema: zodToApiSchema(systemsStressProfileParamsSchema.shape.profileId) })
  @ApiResponse({ status: 200, description: 'Detalle del perfil de estrés.' })
  @ApiResponse({ status: 404, description: 'STRESS_PROFILE_NOT_FOUND.' })
  @Get('stress-profiles/:profileId')
  getStressProfile(@Param(new ZodValidationPipe(systemsStressProfileParamsSchema)) params: SystemsStressProfileParamsDto) {
    return this.service.getStressProfile(params.profileId);
  }

  @ApiOperation({
    summary: 'Encolar una corrida de un perfil de estrés',
    description: 'Requiere aprobación (approvalTicket) para entornos distintos de LOCAL cuando el perfil lo exige.',
  })
  @ApiParam({ name: 'profileId', schema: zodToApiSchema(systemsStressProfileParamsSchema.shape.profileId) })
  @ApiBody({ schema: zodToApiSchema(queueStressRunSchema) })
  @ApiResponse({ status: 201, description: 'Corrida de estrés encolada.' })
  @ApiResponse({ status: 404, description: 'STRESS_PROFILE_NOT_FOUND.' })
  @ApiResponse({ status: 422, description: 'APPROVAL_TICKET_REQUIRED — falta aprobación para el entorno solicitado.' })
  @Roles(...SYSTEMS_OPS_STRESS_ROLES)
  @Post('stress-profiles/:profileId/queue-run')
  queueStressRun(
    @Param(new ZodValidationPipe(systemsStressProfileParamsSchema)) params: SystemsStressProfileParamsDto,
    @Body(new ZodValidationPipe(queueStressRunSchema)) body: QueueStressRunDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stressRunService.queueStressRun(params.profileId, body, user);
  }

  @ApiOperation({ summary: 'Crear o actualizar un perfil de pruebas de estrés' })
  @ApiBody({ schema: zodToApiSchema(upsertStressProfileSchema) })
  @ApiResponse({ status: 200, description: 'Perfil de estrés creado/actualizado.' })
  @Roles(...SYSTEMS_OPS_STRESS_ROLES)
  @Post('stress-profiles')
  upsertStressProfile(
    @Body(new ZodValidationPipe(upsertStressProfileSchema)) body: UpsertStressProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.upsertStressProfile(body, user);
  }

  @ApiOperation({ summary: 'Matriz de cobertura de pruebas de estrés por endpoint' })
  @ApiQuery({ name: 'module', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).module })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).status })
  @ApiQuery({ name: 'riskLevel', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).riskLevel })
  @ApiQuery({ name: 'reviewStatus', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).reviewStatus })
  @ApiQuery({ name: 'q', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).q })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsListQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Matriz de cobertura de estrés.' })
  @Get('stress-matrix')
  getStressMatrix(@Query(new ZodValidationPipe(systemsListQuerySchema)) query: SystemsListQueryDto) {
    return this.service.getStressMatrix(query);
  }

  @ApiOperation({ summary: 'Listar corridas de pruebas de estrés' })
  @ApiQuery({ name: 'suiteId', required: false, schema: zodObjectPropertySchemas(systemsRunsQuerySchema).suiteId })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(systemsRunsQuerySchema).status })
  @ApiQuery({ name: 'environment', required: false, schema: zodObjectPropertySchemas(systemsRunsQuerySchema).environment })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsRunsQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsRunsQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de corridas de estrés.' })
  @Get('stress-runs')
  listStressRuns(@Query(new ZodValidationPipe(systemsRunsQuerySchema)) query: SystemsRunsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.stressRunService.listStressRuns(query, user);
  }
}
