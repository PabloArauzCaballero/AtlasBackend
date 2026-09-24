/**
 * @file Adaptador HTTP: API de control de corridas QA de N personas (`/systems/qa`).
 * @business Esta pieza deja lanzar, seguir y cancelar corridas desde el laboratorio QA sin que el
 *   navegador genere el tráfico de negocio.
 * @system sesión interna + permiso fino por ruta; tenant y operador salen de la sesión.
 */
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
import { SystemsOpsControllerSecurity } from '../systems-ops/systems-controller.decorators.js';
import { SYSTEMS_OPS_FINE_PERMISSION_ROLES } from '../systems-ops/systems-ops.constants.js';
import { QaRunOrchestratorService } from './application/qa-run-orchestrator.service.js';
import { QaRunReadService } from './application/qa-run-read.service.js';
import {
  qaEventsQuerySchema,
  QaEventsQueryDto,
  qaIdempotencyKeySchema,
  qaLaunchSchema,
  QaLaunchDto,
  qaPersonaParamsSchema,
  QaPersonaParamsDto,
  qaPersonasQuerySchema,
  QaPersonasQueryDto,
  qaRunParamsSchema,
  QaRunParamsDto,
  qaRunRequestSchema,
  QaRunRequestDto,
  qaRunsQuerySchema,
  QaRunsQueryDto,
  qaSampleInputsSchema,
  QaSampleInputsDto,
  qaTemplateParamsSchema,
  QaTemplateParamsDto,
  qaWorkflowQuerySchema,
  QaWorkflowQueryDto,
} from './qa-orchestration.schemas.js';

@Controller('systems/qa')
@UseGuards(InternalPermissionsGuard)
@Roles(...SYSTEMS_OPS_FINE_PERMISSION_ROLES)
@SystemsOpsControllerSecurity()
export class QaRunsController {
  constructor(
    private readonly orchestrator: QaRunOrchestratorService,
    private readonly reads: QaRunReadService,
  ) {}

  @ApiOperation({ summary: 'Capacidad QA del entorno: topes publicados, worker y mock' })
  @ApiResponse({ status: 200, description: 'Si se puede ejecutar aquí, con qué límites y si el worker late.' })
  @InternalPermissions('systems.qa.read')
  @Get('capabilities')
  capabilities() {
    return this.orchestrator.capabilities();
  }

  @ApiOperation({ summary: 'Catálogo de journeys precargados' })
  @ApiResponse({ status: 200, description: 'Plantillas con su preparación READY/BLOCKED y sus motivos.' })
  @InternalPermissions('systems.qa.read')
  @Get('journey-templates')
  templates(@Query(new ZodValidationPipe(qaWorkflowQuerySchema)) query: QaWorkflowQueryDto) {
    return this.reads.templates(query.workflowCode);
  }

  @ApiOperation({ summary: 'Receta de un journey: pasos, actores y expectativas' })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'version' })
  @ApiResponse({ status: 200, description: 'Receta inmutable de esa versión.' })
  @ApiResponse({ status: 404, description: 'QA_TEMPLATE_NOT_FOUND.' })
  @InternalPermissions('systems.qa.read')
  @Get('journey-templates/:code/versions/:version')
  template(@Param(new ZodValidationPipe(qaTemplateParamsSchema)) params: QaTemplateParamsDto) {
    return this.reads.template(params.code, params.version);
  }

  @ApiOperation({ summary: 'Datos sintéticos de muestra de un journey, sin ejecutar nada' })
  @ApiBody({ schema: zodToApiSchema(qaSampleInputsSchema) })
  @ApiResponse({ status: 200, description: 'Hasta cinco personas de muestra; no crea usuarios ni llama a proveedores.' })
  @InternalPermissions('systems.qa.read')
  @HttpCode(200)
  @Post('journey-templates/:code/versions/:version/sample-inputs')
  sampleInputs(
    @Param(new ZodValidationPipe(qaTemplateParamsSchema)) params: QaTemplateParamsDto,
    @Body(new ZodValidationPipe(qaSampleInputsSchema)) body: QaSampleInputsDto,
  ) {
    return this.reads.sampleInputs(params.code, params.version, body);
  }

  @ApiOperation({ summary: 'Campañas precargadas' })
  @ApiResponse({ status: 200, description: 'Agrupaciones de plantillas con su reparto.' })
  @InternalPermissions('systems.qa.read')
  @Get('campaigns')
  campaigns() {
    return this.reads.campaigns();
  }

  @ApiOperation({ summary: 'Matriz de cobertura: cada paso del inventario con su receta o su hueco' })
  @ApiResponse({ status: 200, description: 'Filas COVERED/GAP con el motivo del hueco.' })
  @InternalPermissions('systems.qa.read')
  @Get('coverage')
  coverage(@Query(new ZodValidationPipe(qaWorkflowQuerySchema)) query: QaWorkflowQueryDto) {
    return this.reads.coverage(query.workflowCode);
  }

  @ApiOperation({ summary: 'Preflight: resuelve y congela el plan sin generar tráfico' })
  @ApiBody({ schema: zodToApiSchema(qaRunRequestSchema) })
  @ApiResponse({ status: 200, description: 'READY con planId/planHash y límites efectivos, o BLOCKED con motivos accionables.' })
  @InternalPermissions('systems.qa.execute')
  @HttpCode(200)
  @Post('runs/preflight')
  preflight(@Body(new ZodValidationPipe(qaRunRequestSchema)) body: QaRunRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orchestrator.preflight(user, { ...body, limits: body.limits });
  }

  @ApiOperation({ summary: 'Lanzar una corrida a partir de un plan READY' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Misma clave + mismo plan = misma corrida.' })
  @ApiBody({ schema: zodToApiSchema(qaLaunchSchema) })
  @ApiResponse({ status: 202, description: 'Corrida encolada: runId consultable.' })
  @ApiResponse({ status: 409, description: 'PLAN_EXPIRED | PLAN_CHANGED | IDEMPOTENCY_KEY_REUSED | QA_RUN_ALREADY_ACTIVE.' })
  @ApiResponse({ status: 503, description: 'WORKER_UNAVAILABLE o QA deshabilitado en el entorno.' })
  @InternalPermissions('systems.qa.execute')
  @HttpCode(202)
  @Post('runs')
  launch(
    @Body(new ZodValidationPipe(qaLaunchSchema)) body: QaLaunchDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-idempotency-key') legacyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const key = qaIdempotencyKeySchema.safeParse(idempotencyKey ?? legacyKey);
    if (!key.success) throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED');
    return this.orchestrator.launch(user, { ...body, idempotencyKey: key.data });
  }

  @ApiOperation({ summary: 'Corridas recientes del tenant' })
  @ApiResponse({ status: 200, description: 'Lista, la más reciente primero.' })
  @InternalPermissions('systems.qa.read')
  @Get('runs')
  runs(@Query(new ZodValidationPipe(qaRunsQuerySchema)) query: QaRunsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reads.runs(user, query);
  }

  @ApiOperation({ summary: 'Estado, contadores, causa raíz y evidencia de una corrida' })
  @ApiParam({ name: 'runId' })
  @ApiResponse({ status: 200, description: 'Resumen de la corrida; COMPLETED no significa aprobada: ver verdict.' })
  @ApiResponse({ status: 404, description: 'QA_RUN_NOT_FOUND.' })
  @InternalPermissions('systems.qa.read')
  @Get('runs/:runId')
  run(@Param(new ZodValidationPipe(qaRunParamsSchema)) params: QaRunParamsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reads.run(user, params.runId);
  }

  @ApiOperation({ summary: 'Personas de una corrida, paginadas y sin tokens' })
  @ApiParam({ name: 'runId' })
  @ApiResponse({ status: 200, description: 'Página de personas con su estado y paso fallido.' })
  @InternalPermissions('systems.qa.read')
  @Get('runs/:runId/personas')
  personas(
    @Param(new ZodValidationPipe(qaRunParamsSchema)) params: QaRunParamsDto,
    @Query(new ZodValidationPipe(qaPersonasQuerySchema)) query: QaPersonasQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reads.personas(user, params.runId, query);
  }

  @ApiOperation({ summary: 'Pasos e intentos saneados de una persona' })
  @ApiParam({ name: 'runId' })
  @ApiParam({ name: 'personaKey' })
  @ApiResponse({ status: 200, description: 'Pasos con aserciones, intentos y evidencia saneada.' })
  @InternalPermissions('systems.qa.read')
  @Get('runs/:runId/personas/:personaKey/steps')
  steps(@Param(new ZodValidationPipe(qaPersonaParamsSchema)) params: QaPersonaParamsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reads.steps(user, params.runId, params.personaKey);
  }

  @ApiOperation({ summary: 'Eventos incrementales de una corrida para el sondeo del portal' })
  @ApiParam({ name: 'runId' })
  @ApiResponse({ status: 200, description: 'Eventos posteriores al cursor.' })
  @InternalPermissions('systems.qa.read')
  @Get('runs/:runId/events')
  events(
    @Param(new ZodValidationPipe(qaRunParamsSchema)) params: QaRunParamsDto,
    @Query(new ZodValidationPipe(qaEventsQuerySchema)) query: QaEventsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reads.events(user, params.runId, query.after);
  }

  @ApiOperation({ summary: 'Cancelar una corrida (idempotente)' })
  @ApiParam({ name: 'runId' })
  @ApiResponse({ status: 202, description: 'CANCELLING hasta reconciliar lo aceptado, o terminal si no había empezado.' })
  @InternalPermissions('systems.qa.execute')
  @HttpCode(202)
  @Post('runs/:runId/cancel')
  cancel(@Param(new ZodValidationPipe(qaRunParamsSchema)) params: QaRunParamsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orchestrator.cancel(user, params.runId);
  }

  @ApiOperation({ summary: 'Manifiesto de evidencia de una corrida' })
  @ApiParam({ name: 'runId' })
  @ApiResponse({ status: 200, description: 'Hashes, versiones, contadores, veredicto y resumen del journal del mock.' })
  @InternalPermissions('systems.qa.read')
  @Get('runs/:runId/evidence')
  evidence(@Param(new ZodValidationPipe(qaRunParamsSchema)) params: QaRunParamsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reads.evidence(user, params.runId);
  }
}
