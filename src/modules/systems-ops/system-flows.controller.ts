/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system expone Flujos (Flow Intelligence): carga del artefacto derivado y consultas del explorador.
 */
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { AccessToken } from '../../common/decorators/access-token.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { actorId } from './systems-actor.util.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
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
@UseGuards(InternalPermissionsGuard)
@SystemsOpsControllerSecurity()
/**
 * Y ADEMÁS el permiso fino, que es lo que el catálogo de RBAC promete desde el primer día.
 *
 * El decorador de arriba comprueba el ROL, que es grueso: `SYSTEMS_OPS_ROLES` incluye a qa_engineer,
 * devops y risk_analyst, así que cualquiera de ellos leía el mapa completo de rutas, permisos y
 * hallazgos de los cuatro bloques. `systems.flows.read` existía, estaba sembrado, el menú del portal
 * ya lo usaba para decidir si enseñar la sección… y el backend no lo exigía. La ficha del catálogo
 * afirmaba que sí: era la propia herramienta contando algo que no era verdad.
 *
 * `InternalPermissionsGuard` exige además una sesión INTERNA: un `platform_user` con rol de admin ya
 * no entra. Es lo correcto —estos endpoints son gobierno interno, no producto— y obliga a que quien
 * carga el artefacto lo haga con una identidad a la que se le puede revocar el permiso.
 *
 * ## Por qué el `@UseGuards` va ARRIBA y no aquí
 *
 * Los decoradores de clase se aplican de abajo arriba y `UseGuards` EXTIENDE el array, así que
 * declarado debajo quedaba `[InternalPermissionsGuard, JwtAuthGuard, RolesGuard]` —medido, no
 * supuesto—: el guard de permisos antes que el de sesión. Preguntar por el permiso de alguien a
 * quien todavía no se ha identificado devuelve «requiere una sesión interna» a un usuario válido.
 * Hoy no rompía porque `JwtAuthGuard` y `RolesGuard` son además `APP_GUARD` y los globales corren
 * primero; eso hacía que el controlador dependiera de una configuración de otro fichero.
 */
export class SystemFlowsController {
  constructor(private readonly service: SystemFlowsService) {}

  @ApiOperation({ summary: 'Resumen de Flujos: totales por riesgo, verificación, frescura y bloque' })
  @ApiResponse({ status: 200, description: 'Conteos para las tarjetas del explorador.' })
  @InternalPermissions('systems.flows.read')
  @Get('flows/summary')
  summary() {
    return this.service.summary();
  }

  @ApiOperation({ summary: 'Procesos de negocio del catálogo de flujos, con cada paso enlazado a su flujo' })
  @ApiResponse({ status: 200, description: 'Procesos activos con sus pasos, cuáles están enlazados y cuáles no.' })
  @InternalPermissions('systems.flows.read')
  @Get('flows/business')
  businessFlows() {
    return this.service.businessFlows();
  }

  /**
   * Deriva de RBAC: pantallas cuya puerta declarada en el menú no es la que aplica la API.
   *
   * Lectura, no análisis: no recalcula el catálogo, cruza lo que ya hay. Por eso `read` y no
   * `analyze`.
   */
  /**
   * Lo que cada flujo deja encargado al terminar de responder, y si alguien lo recoge.
   *
   * El mapa acababa en el endpoint: un flujo que encola un correo o un recálculo parecía terminar
   * ahí. Esto lo cruza con los eventos que de verdad se escribieron.
   */
  @ApiOperation({ summary: 'Trabajo que los flujos dejan encargado, y si alguien lo recoge' })
  @ApiResponse({
    status: 200,
    description: 'Eventos escritos por cada flujo en la ventana, con cuántos siguen sin recogerse.',
  })
  @InternalPermissions('systems.flows.read')
  @Get('flows/pending-work')
  pendingWork(@Query('windowDays') windowDays?: string) {
    const dias = Number(windowDays ?? 30);
    // `Math.trunc(0.5)` daba 0 y la respuesta salía vacía, que se lee como «no se encola nada».
    return this.service.pendingWork(Number.isFinite(dias) && dias >= 1 && dias <= 365 ? Math.trunc(dias) : 30);
  }

  @ApiOperation({ summary: 'Pantallas cuya puerta declarada no es la que aplica la API' })
  @ApiResponse({
    status: 200,
    description:
      'Pantallas con aristas observadas cuyo endpoint no exige el permiso que el menú declara, ' +
      'clasificadas en SIN_GUARDA (avería), PUBLIC (decisión declarada) y SOLO_ROL (otra puerta).',
  })
  @InternalPermissions('systems.flows.read')
  @Get('flows/rbac-drift')
  rbacDrift() {
    return this.service.rbacDrift();
  }

  @ApiOperation({ summary: 'Módulos con flujos, por bloque' })
  @ApiResponse({ status: 200, description: 'Lista de (bloque, módulo, cantidad).' })
  @InternalPermissions('systems.flows.read')
  @Get('flows/modules')
  modules() {
    return this.service.modules();
  }

  @ApiOperation({ summary: 'Listar flujos derivados del código' })
  @ApiResponse({ status: 200, description: 'Lista paginada de flujos con filtros por bloque, módulo, tipo, riesgo y estado.' })
  @InternalPermissions('systems.flows.read')
  @Get('flows')
  list(@Query(new ZodValidationPipe(flowsListQuerySchema)) query: FlowsListQueryDto) {
    return this.service.listFlows(query);
  }

  @ApiOperation({ summary: 'Pantallas de los clientes con los permisos que exige su menú' })
  @ApiResponse({ status: 200, description: 'Lista paginada de pantallas.' })
  @InternalPermissions('systems.flows.read')
  @Get('flows/screens')
  screens(@Query(new ZodValidationPipe(screensListQuerySchema)) query: ScreensListQueryDto) {
    return this.service.listScreens(query);
  }

  @ApiOperation({ summary: 'Hallazgos de los detectores de Flujos' })
  @ApiResponse({ status: 200, description: 'Lista paginada de hallazgos (abiertos por defecto).' })
  @InternalPermissions('systems.flows.read')
  @Get('flows/findings')
  findings(@Query(new ZodValidationPipe(findingsListQuerySchema)) query: FindingsListQueryDto) {
    return this.service.listFindings(query);
  }

  @ApiOperation({ summary: 'Últimas cargas del artefacto de Flujos' })
  @ApiResponse({ status: 200, description: 'Quién cargó qué bloque, con qué commit y cuántas filas.' })
  @InternalPermissions('systems.flows.read')
  @Get('flows/imports')
  imports() {
    return this.service.imports();
  }

  @ApiOperation({ summary: 'Grafo de un módulo: sus flujos compartiendo clientes y controllers' })
  @ApiResponse({ status: 200, description: 'Nodos y aristas tipados con confianza y evidencia.' })
  @ApiResponse({ status: 404, description: 'No hay flujos para ese bloque y módulo.' })
  @InternalPermissions('systems.flows.read')
  @Get('flows/graph')
  moduleGraph(@Query(new ZodValidationPipe(flowsGraphQuerySchema)) query: FlowsGraphQueryDto) {
    return this.service.getModuleGraph(query);
  }

  @ApiOperation({ summary: 'Grafo de un flujo: cliente → request → endpoint → autorización → handler → (sin resolver)' })
  @ApiParam({ name: 'flowId', schema: zodToApiSchema(flowIdParamsSchema.shape.flowId) })
  @ApiResponse({ status: 200, description: 'Nodos y aristas del flujo.' })
  @ApiResponse({ status: 404, description: 'No existe el flujo.' })
  @InternalPermissions('systems.flows.read')
  @Get('flows/:flowId/graph')
  flowGraph(@Param(new ZodValidationPipe(flowIdParamsSchema)) params: FlowIdParamsDto) {
    return this.service.getFlowGraph(params.flowId);
  }

  @ApiOperation({ summary: 'Detalle de un flujo con sus hallazgos' })
  @ApiParam({ name: 'flowId', schema: zodToApiSchema(flowIdParamsSchema.shape.flowId) })
  @ApiResponse({ status: 200, description: 'Flujo.' })
  @ApiResponse({ status: 404, description: 'No existe el flujo.' })
  @InternalPermissions('systems.flows.read')
  @Get('flows/:flowId')
  detail(@Param(new ZodValidationPipe(flowIdParamsSchema)) params: FlowIdParamsDto) {
    return this.service.getFlow(params.flowId);
  }

  @ApiOperation({ summary: 'Verificar los flujos contra corridas reales (system_action_logs) y recalcular su frescura' })
  @ApiBody({ schema: zodToApiSchema(verifyFlowsSchema) })
  @ApiResponse({ status: 201, description: 'Cuántos flujos quedaron VERIFIED, BROKEN, sin corridas, FRESH y STALE.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @InternalPermissions('systems.flows.analyze')
  @Post('flows/verify')
  verify(
    @Body(new ZodValidationPipe(verifyFlowsSchema)) body: VerifyFlowsDto,
    @CurrentUser() user: AuthenticatedUser,
    @AccessToken() callerToken: string | null,
  ) {
    return this.service.verify(body, actorId(user), callerToken);
  }

  @ApiOperation({ summary: 'Cargar los endpoints derivados de un bloque (reemplaza los del bloque)' })
  @ApiBody({ schema: zodToApiSchema(importEndpointsSchema) })
  @ApiResponse({ status: 201, description: 'Filas cargadas y retiradas.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @InternalPermissions('systems.flows.analyze')
  @Post('flows/import/endpoints')
  importEndpoints(@Body(new ZodValidationPipe(importEndpointsSchema)) body: ImportEndpointsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.importEndpoints(body, actorId(user));
  }

  @ApiOperation({ summary: 'Cargar las pantallas derivadas de un cliente (reemplaza las del cliente)' })
  @ApiBody({ schema: zodToApiSchema(importScreensSchema) })
  @ApiResponse({ status: 201, description: 'Filas cargadas y retiradas.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @InternalPermissions('systems.flows.analyze')
  @Post('flows/import/screens')
  importScreens(@Body(new ZodValidationPipe(importScreensSchema)) body: ImportScreensDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.importScreens(body, actorId(user));
  }

  @ApiOperation({ summary: 'Cargar los hallazgos de un bloque (los que ya no vienen se marcan resueltos)' })
  @ApiBody({ schema: zodToApiSchema(importFindingsSchema) })
  @ApiResponse({ status: 201, description: 'Filas cargadas, resueltas e ignoradas por bloque distinto.' })
  @Roles(...SYSTEMS_OPS_GOVERNANCE_ROLES)
  @InternalPermissions('systems.flows.analyze')
  @Post('flows/import/findings')
  importFindings(@Body(new ZodValidationPipe(importFindingsSchema)) body: ImportFindingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.importFindings(body, actorId(user));
  }
}
