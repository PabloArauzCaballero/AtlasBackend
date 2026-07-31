/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { WORKFLOW_CATALOG_READ_ROLES } from './workflow-catalog.constants.js';
import {
  ListWorkflowsQueryDto,
  ValidateWorkflowTransitionDto,
  WorkflowCodeParamsDto,
  WorkflowTreeQueryDto,
  listWorkflowsQuerySchema,
  validateWorkflowTransitionSchema,
  workflowCodeParamsSchema,
  workflowTreeQuerySchema,
} from './workflow-catalog.schemas.js';
import { WorkflowCatalogService } from './workflow-catalog.service.js';
import { WorkflowTransitionService } from './application/workflow-transition.service.js';

/**
 * Lectura pública (para actores autenticados) del árbol de endpoints del proceso.
 *
 * El catálogo describe el software desplegado, no los datos de un tenant: por eso no hay
 * `x-tenant-id` ni `TenantGuard` en este controlador. Lo que sí es por cliente —su avance— vive en
 * `WorkflowProgressController`, que sí cruza tenant y ownership.
 */
@ApiTags('workflow-catalog')
@ApiBearerAuth('access-token')
@Controller('workflows')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORKFLOW_CATALOG_READ_ROLES)
export class WorkflowCatalogController {
  constructor(
    private readonly catalogService: WorkflowCatalogService,
    private readonly transitionService: WorkflowTransitionService,
  ) {}

  @ApiOperation({
    summary: 'Listar los flujos de trabajo registrados',
    description:
      'Devuelve una fila por versión de flujo. `moduleCode` y `role` filtran por lo que el flujo contiene, ' +
      'no por atributos de la cabecera: un flujo aparece si alguna de sus etapas pertenece al módulo o si alguno ' +
      'de sus pasos autoriza al rol.',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'processType', required: false })
  @ApiQuery({ name: 'ownerDomain', required: false })
  @ApiQuery({ name: 'moduleCode', required: false })
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({ name: 'includeDeprecated', required: false })
  @ApiResponse({ status: 200, description: 'Flujos registrados, ordenados por código y versión descendente.' })
  @Get()
  list(@Query(new ZodValidationPipe(listWorkflowsQuerySchema)) query: ListWorkflowsQueryDto) {
    return this.catalogService.listWorkflows(query);
  }

  @ApiOperation({ summary: 'Versiones registradas de un flujo' })
  @ApiParam({ name: 'workflowCode', schema: zodToApiSchema(workflowCodeParamsSchema.shape.workflowCode) })
  @ApiResponse({ status: 200, description: 'Versiones del flujo, de la más reciente a la más antigua.' })
  @ApiResponse({ status: 404, description: 'WORKFLOW_NOT_FOUND.' })
  @Get(':workflowCode/versions')
  listVersions(@Param(new ZodValidationPipe(workflowCodeParamsSchema)) params: WorkflowCodeParamsDto) {
    return this.catalogService.listVersions(params.workflowCode);
  }

  @ApiOperation({
    summary: 'Árbol completo de un flujo',
    description:
      'Etapas anidadas con sus subetapas y pasos, más las transiciones y dependencias. `version=latest` (por defecto) ' +
      'resuelve la versión marcada como predeterminada y, si no hay ninguna, la activa más reciente.',
  })
  @ApiParam({ name: 'workflowCode', schema: zodToApiSchema(workflowCodeParamsSchema.shape.workflowCode) })
  @ApiQuery({ name: 'version', required: false, description: '`latest` o una versión concreta (`v1`).' })
  @ApiQuery({ name: 'moduleCode', required: false })
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({ name: 'lifecycleStatus', required: false })
  @ApiQuery({ name: 'actorType', required: false })
  @ApiResponse({ status: 200, description: 'Árbol del flujo con totales de etapas, pasos, transiciones y dependencias.' })
  @ApiResponse({ status: 404, description: 'WORKFLOW_NOT_FOUND.' })
  @Get(':workflowCode')
  getTree(
    @Param(new ZodValidationPipe(workflowCodeParamsSchema)) params: WorkflowCodeParamsDto,
    @Query(new ZodValidationPipe(workflowTreeQuerySchema)) query: WorkflowTreeQueryDto,
  ) {
    return this.catalogService.getTree(params.workflowCode, query);
  }

  @ApiOperation({
    summary: 'Etapas del flujo en orden de ejecución',
    description: 'Versión aplanada del árbol con `depth`, para pintar un recorrido lineal sin recorrer la jerarquía.',
  })
  @ApiParam({ name: 'workflowCode', schema: zodToApiSchema(workflowCodeParamsSchema.shape.workflowCode) })
  @ApiResponse({ status: 200, description: 'Etapas ordenadas, con sus pasos.' })
  @Get(':workflowCode/stages')
  listStages(
    @Param(new ZodValidationPipe(workflowCodeParamsSchema)) params: WorkflowCodeParamsDto,
    @Query(new ZodValidationPipe(workflowTreeQuerySchema)) query: WorkflowTreeQueryDto,
  ) {
    return this.catalogService.listStages(params.workflowCode, query);
  }

  @ApiOperation({ summary: 'Transiciones declaradas del flujo' })
  @ApiParam({ name: 'workflowCode', schema: zodToApiSchema(workflowCodeParamsSchema.shape.workflowCode) })
  @ApiResponse({ status: 200, description: 'Transiciones con su condición, origen y destino.' })
  @Get(':workflowCode/transitions')
  listTransitions(
    @Param(new ZodValidationPipe(workflowCodeParamsSchema)) params: WorkflowCodeParamsDto,
    @Query(new ZodValidationPipe(workflowTreeQuerySchema)) query: WorkflowTreeQueryDto,
  ) {
    return this.catalogService.listTransitions(params.workflowCode, query);
  }

  @ApiOperation({
    summary: 'Representación de grafo para visualización',
    description: 'Nodos (etapas y pasos) y aristas (transiciones y dependencias) listos para una librería de diagramas.',
  })
  @ApiParam({ name: 'workflowCode', schema: zodToApiSchema(workflowCodeParamsSchema.shape.workflowCode) })
  @ApiResponse({ status: 200, description: 'Grafo del flujo.' })
  @Get(':workflowCode/graph')
  getGraph(
    @Param(new ZodValidationPipe(workflowCodeParamsSchema)) params: WorkflowCodeParamsDto,
    @Query(new ZodValidationPipe(workflowTreeQuerySchema)) query: WorkflowTreeQueryDto,
  ) {
    return this.catalogService.getGraph(params.workflowCode, query);
  }

  @ApiOperation({
    summary: 'Validar si una transición está permitida',
    description:
      'Comprueba el grafo declarado: que la transición exista, que las dependencias obligatorias estén cubiertas y que ' +
      'rol y estado encajen con el paso destino. NO sustituye a los guards ni a las reglas del servicio real, que se ' +
      'siguen aplicando al ejecutar el endpoint.',
  })
  @ApiParam({ name: 'workflowCode', schema: zodToApiSchema(workflowCodeParamsSchema.shape.workflowCode) })
  @ApiBody({ schema: zodToApiSchema(validateWorkflowTransitionSchema) })
  @ApiResponse({ status: 200, description: 'Resultado con `allowed` y un `reasonCode` explícito.' })
  @ApiResponse({ status: 404, description: 'WORKFLOW_NOT_FOUND.' })
  @Post(':workflowCode/transitions/validate')
  @HttpCode(HttpStatus.OK)
  validateTransition(
    @Param(new ZodValidationPipe(workflowCodeParamsSchema)) params: WorkflowCodeParamsDto,
    @Body(new ZodValidationPipe(validateWorkflowTransitionSchema)) body: ValidateWorkflowTransitionDto,
  ) {
    return this.transitionService.validate(params.workflowCode, body);
  }
}
