/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system expone Flujos (Flow Intelligence): carga del artefacto derivado y consultas del explorador.
 */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { actorId } from './systems-actor.util.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import { SYSTEMS_OPS_GOVERNANCE_ROLES } from './systems-ops.constants.js';
import { SystemFlowsService } from './system-flows.service.js';
import {
  FindingsListQueryDto,
  findingsListQuerySchema,
  FlowIdParamsDto,
  flowIdParamsSchema,
  FlowsGraphQueryDto,
  flowsGraphQuerySchema,
  FlowsListQueryDto,
  flowsListQuerySchema,
  ImportEndpointsDto,
  importEndpointsSchema,
  ImportFindingsDto,
  importFindingsSchema,
  ImportScreensDto,
  importScreensSchema,
  ScreensListQueryDto,
  screensListQuerySchema,
  VerifyFlowsDto,
  verifyFlowsSchema,
} from './system-flows.schemas.js';

/**
 * Lectura: los mismos roles que el resto del catálogo de sistemas (`@SystemsOpsControllerSecurity`).
 * Carga del artefacto: sólo gobernanza, porque reemplaza el catálogo entero del bloque.
 * Pulsar una card en el portal NUNCA ejecuta el endpoint que describe: aquí sólo se lee y se importa.
 */
@Controller('systems')
@SystemsOpsControllerSecurity()
export class SystemFlowsController {
  constructor(private readonly service: SystemFlowsService) {}

  @ApiOperation({ summary: 'Resumen de Flujos: totales por riesgo, verificación, frescura y bloque' })
  @ApiResponse({ status: 200, description: 'Conteos para las tarjetas del explorador.' })
  @Get('flows/summary')
  summary() {
    return this.service.summary();
  }

  @ApiOperation({ summary: 'Procesos de negocio del catálogo de flujos, con cada paso enlazado a su flujo' })
  @ApiResponse({ status: 200, description: 'Procesos activos con sus pasos, cuáles están enlazados y cuáles no.' })
  @Get('flows/business')
  businessFlows() {
    return this.service.businessFlows();
  }

  @ApiOperation({ summary: 'Módulos con flujos, por bloque' })
  @ApiResponse({ status: 200, description: 'Lista de (bloque, módulo, cantidad).' })
  @Get('flows/modules')
  modules() {
    return this.service.modules();
  }

  @ApiOperation({ summary: 'Listar flujos derivados del código' })
  @ApiResponse({ status: 200, description: 'Lista paginada de flujos con filtros por bloque, módulo, tipo, riesgo y estado.' })
  @Get('flows')
  list(@Query(new ZodValidationPipe(flowsListQuerySchema)) query: FlowsListQueryDto) {
    return this.service.listFlows(query);
  }

  @ApiOperation({ summary: 'Pantallas de los clientes con los permisos que exige su menú' })
  @ApiResponse({ status: 200, description: 'Lista paginada de pantallas.' })
  @Get('flows/screens')
  screens(@Query(new ZodValidationPipe(screensListQuerySchema)) query: ScreensListQueryDto) {
    return this.service.listScreens(query);
  }

  @ApiOperation({ summary: 'Hallazgos de los detectores de Flujos' })
  @ApiResponse({ status: 200, description: 'Lista paginada de hallazgos (abiertos por defecto).' })
  @Get('flows/findings')
  findings(@Query(new ZodValidationPipe(findingsListQuerySchema)) query: FindingsListQueryDto) {
    return this.service.listFindings(query);
  }

  @ApiOperation({ summary: 'Últimas cargas del artefacto de Flujos' })
  @ApiResponse({ status: 200, description: 'Quién cargó qué bloque, con qué commit y cuántas filas.' })
  @Get('flows/imports')
  imports() {
    return this.service.imports();
  }

  @ApiOperation({ summary: 'Grafo de un módulo: sus flujos compartiendo clientes y controllers' })
  @ApiResponse({ status: 200, description: 'Nodos y aristas tipados con confianza y evidencia.' })
  @ApiResponse({ status: 404, description: 'No hay flujos para ese bloque y módulo.' })
  @Get('flows/graph')
  moduleGraph(@Query(new ZodValidationPipe(flowsGraphQuerySchema)) query: FlowsGraphQueryDto) {
    return this.service.getModuleGraph(query);
  }

  @ApiOperation({ summary: 'Grafo de un flujo: cliente → request → endpoint → autorización → handler → (sin resolver)' })
  @ApiParam({ name: 'flowId', schema: zodToApiSchema(flowIdParamsSchema.shape.flowId) })
  @ApiResponse({ status: 200, description: 'Nodos y aristas del flujo.' })
  @ApiResponse({ status: 404, description: 'No existe el flujo.' })
  @Get('flows/:flowId/graph')
  flowGraph(@Param(new ZodValidationPipe(flowIdParamsSchema)) params: FlowIdParamsDto) {
    return this.service.getFlowGraph(params.flowId);
  }

  @ApiOperation({ summary: 'Detalle de un flujo con sus hallazgos' })
  @ApiParam({ name: 'flowId', schema: zodToApiSchema(flowIdParamsSchema.shape.flowId) })
  @ApiResponse({ status: 200, description: 'Flujo.' })
  @ApiResponse({ status: 404, description: 'No existe el flujo.' })
  @Get('flows/:flowId')
  detail(@Param(new ZodValidationPipe(flowIdParamsSchema)) params: FlowIdParamsDto) {
    return this.service.getFlow(params.flowId);
  }

  @ApiOperation({ summary: 'Verificar los flujos contra corridas reales (system_action_logs) y recalcular su frescura' })
  @ApiBody({ schema: zodToApiSchema(verifyFlowsSchema) })
  @ApiResponse({ status: 201, description: 'Cuántos flujos quedaron VERIFIED, BROKEN, sin corridas, FRESH y STALE.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @Post('flows/verify')
  verify(@Body(new ZodValidationPipe(verifyFlowsSchema)) body: VerifyFlowsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.verify(body, actorId(user));
  }

  @ApiOperation({ summary: 'Cargar los endpoints derivados de un bloque (reemplaza los del bloque)' })
  @ApiBody({ schema: zodToApiSchema(importEndpointsSchema) })
  @ApiResponse({ status: 201, description: 'Filas cargadas y retiradas.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @Post('flows/import/endpoints')
  importEndpoints(@Body(new ZodValidationPipe(importEndpointsSchema)) body: ImportEndpointsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.importEndpoints(body, actorId(user));
  }

  @ApiOperation({ summary: 'Cargar las pantallas derivadas de un cliente (reemplaza las del cliente)' })
  @ApiBody({ schema: zodToApiSchema(importScreensSchema) })
  @ApiResponse({ status: 201, description: 'Filas cargadas y retiradas.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @Post('flows/import/screens')
  importScreens(@Body(new ZodValidationPipe(importScreensSchema)) body: ImportScreensDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.importScreens(body, actorId(user));
  }

  @ApiOperation({ summary: 'Cargar los hallazgos de un bloque (los que ya no vienen se marcan resueltos)' })
  @ApiBody({ schema: zodToApiSchema(importFindingsSchema) })
  @ApiResponse({ status: 201, description: 'Filas cargadas, resueltas e ignoradas por bloque distinto.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @Post('flows/import/findings')
  importFindings(@Body(new ZodValidationPipe(importFindingsSchema)) body: ImportFindingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.importFindings(body, actorId(user));
  }
}
