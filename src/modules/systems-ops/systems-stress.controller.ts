/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
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
  systemsStressRunsQuerySchema,
  SystemsStressRunsQueryDto,
  systemsStressProfileParamsSchema,
  SystemsStressProfileParamsDto,
  systemsStressProfileQuerySchema,
  SystemsStressProfileQueryDto,
  upsertStressProfileSchema,
  UpsertStressProfileDto,
} from './systems-ops.schemas.js';
import { SystemsStressProfileService } from './systems-stress-profile.service.js';
import { SystemsStressRunService } from './systems-stress-run.service.js';

const stressRunQuery = zodObjectPropertySchemas(systemsStressRunsQuerySchema);

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
    description:
      'Inserta la corrida en `system_job_runs` (`queued`). La ejecuta el consumidor de Core `consume_systems_stress_runs`, ' +
      'que sólo corre con `RUNTIME_JOBS_STRESS_CONSUMER_ENABLED=true`; la respuesta dice `consumerEnabled` y, si es `false`, ' +
      'la corrida se queda en cola (consúltalo antes en `GET /systems/stress-runs/capabilities`). Una corrida real exige ' +
      '`approvalTicket` cuando el perfil pide aprobación.',
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
  @ApiResponse({ status: 201, description: 'Perfil de estrés creado/actualizado.' })
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

  @ApiOperation({
    summary: '¿Se ejecutan las corridas de estrés en este entorno?',
    description:
      '`consumerEnabled: false` significa que lo que se encole se queda en `queued`: el portal deshabilita el botón con `disabledReason`.',
  })
  @ApiResponse({ status: 200, description: 'Estado del consumidor de corridas de estrés.' })
  @Get('stress-runs/capabilities')
  getStressRunCapabilities() {
    return this.stressRunService.capabilities();
  }

  @ApiOperation({ summary: 'Listar corridas de pruebas de estrés' })
  @ApiQuery({ name: 'profileId', required: false, schema: stressRunQuery.profileId, description: 'Sólo las corridas de este perfil.' })
  @ApiQuery({
    name: 'suiteId',
    required: false,
    schema: stressRunQuery.suiteId,
    deprecated: true,
    description: 'Obsoleto: alias de `profileId`.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    schema: stressRunQuery.status,
    description: 'Estado en la cola; `PASSED` equivale a `COMPLETED`.',
  })
  @ApiQuery({ name: 'environment', required: false, schema: stressRunQuery.environment, description: 'Ambiente con el que se encoló.' })
  @ApiQuery({
    name: 'q',
    required: false,
    schema: stressRunQuery.q,
    description: 'Código del perfil (contiene) o número exacto de la corrida.',
  })
  @ApiQuery({ name: 'page', required: false, schema: stressRunQuery.page, description: 'Página solicitada, desde 1.' })
  @ApiQuery({ name: 'limit', required: false, schema: stressRunQuery.limit, description: 'Elementos por página (1-100).' })
  @ApiResponse({ status: 200, description: 'Lista paginada de corridas de estrés.' })
  @Get('stress-runs')
  listStressRuns(
    @Query(new ZodValidationPipe(systemsStressRunsQuerySchema)) query: SystemsStressRunsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stressRunService.listStressRuns(query, user);
  }
}
