/**
 * @file Adaptador HTTP: la sección Procesos del portal admin.
 * @business Esta pieza enseña a las personas de Atlas cada proceso de negocio, si está documentado, si cada paso tiene pantalla y qué casos hay en curso.
 * @system rutas de sólo lectura bajo `internal/processes`, con sesión interna y permiso fino `workflows.read`.
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
import { ProcessCatalogService } from './application/process-catalog.service.js';
import {
  processCodeParamsSchema,
  processInstanceParamsSchema,
  processInstancesQuerySchema,
  type ProcessCodeParamsDto,
  type ProcessInstanceParamsDto,
  type ProcessInstancesQueryDto,
} from './process-catalog.schemas.js';

/**
 * Los roles de sesión que emite `legacyRoleForInternalRoles` para una persona interna. Quién ve qué
 * lo decide el permiso `workflows.read`, no el rol: el rol sólo cierra la puerta a clientes y comercios.
 */
const PROCESS_READ_ROLES = [
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'qa_engineer',
  'readonly_auditor',
  'admin',
  'platform_admin',
  'system_admin',
] as const;

/**
 * No se toca `GET /workflows`: lo lee también la app del cliente (rol `customer`) y no debe recibir
 * narrativas internas, dueños ni estado de cableado.
 */
@ApiTags('workflow-catalog')
@ApiBearerAuth('access-token')
@Controller('internal/processes')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, InternalPermissionsGuard)
@Roles(...PROCESS_READ_ROLES)
@InternalPermissions('workflows.read')
export class ProcessCatalogController {
  constructor(private readonly processes: ProcessCatalogService) {}

  @ApiOperation({
    summary: 'Procesos de Atlas con su estado de documentación y de cableado',
    description:
      'Una fila por proceso declarado en código: prioridad, dueño, bloques, clientes, las cinco comprobaciones de documentación ' +
      '(narrativa, dueño, entidad de instancia, pantallas, volcado en esta base) y los pasos de personas con y sin pantalla.',
  })
  @ApiResponse({ status: 200, description: 'Totales y procesos.' })
  @ApiResponse({ status: 403, description: 'Sin sesión interna o sin workflows.read.' })
  @Get()
  list() {
    return this.processes.list();
  }

  @ApiOperation({ summary: 'Ficha de un proceso: narrativa, etapas y pasos con su flujo y su cableado' })
  @ApiParam({ name: 'code', schema: zodToApiSchema(processCodeParamsSchema.shape.code) })
  @ApiResponse({ status: 200, description: 'Proceso completo.' })
  @ApiResponse({ status: 404, description: 'PROCESS_NOT_FOUND.' })
  @Get(':code')
  detail(@Param(new ZodValidationPipe(processCodeParamsSchema)) params: ProcessCodeParamsDto) {
    return this.processes.detail(params.code);
  }

  @ApiOperation({
    summary: 'Cableado de un proceso: cada paso de una persona y si su portal lo llama',
    description: '`unwired` es un paso que una persona tiene que hacer desde un portal que no llama a su ruta (PROCESS_STEP_UNWIRED).',
  })
  @ApiParam({ name: 'code', schema: zodToApiSchema(processCodeParamsSchema.shape.code) })
  @ApiResponse({ status: 200, description: 'Pasos de personas con su estado de cableado.' })
  @Get(':code/wiring')
  wiring(@Param(new ZodValidationPipe(processCodeParamsSchema)) params: ProcessCodeParamsDto) {
    return this.processes.wiring(params.code);
  }

  @ApiOperation({
    summary: 'Instancias en curso de un proceso, por estado',
    description: 'Sólo para procesos cuya entidad vive en este bloque; si no, dice dónde consultarlas.',
  })
  @ApiParam({ name: 'code', schema: zodToApiSchema(processCodeParamsSchema.shape.code) })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Sólo las instancias en este estado (el valor tal cual lo guarda la tabla de la instancia).',
  })
  @ApiQuery({ name: 'search', required: false, description: 'Id exacto o parte del nombre legible de la instancia.' })
  @ApiQuery({ name: 'page', required: false, description: 'Página, desde 1.' })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Instancias por página (1 a 100; 25 por defecto).' })
  @ApiResponse({ status: 200, description: 'Recuento por estado y página de instancias.' })
  @Get(':code/instances')
  instances(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(processCodeParamsSchema)) params: ProcessCodeParamsDto,
    @Query(new ZodValidationPipe(processInstancesQuerySchema)) query: ProcessInstancesQueryDto,
  ) {
    return this.processes.instances(params.code, tenantId, query);
  }

  @ApiOperation({ summary: 'Dónde va una instancia dentro del proceso' })
  @ApiParam({ name: 'code', schema: zodToApiSchema(processInstanceParamsSchema.shape.code) })
  @ApiParam({ name: 'instanceId', schema: zodToApiSchema(processInstanceParamsSchema.shape.instanceId) })
  @ApiResponse({ status: 200, description: 'La instancia y el estado de cada etapa.' })
  @ApiResponse({ status: 404, description: 'PROCESS_INSTANCE_NOT_FOUND o PROCESS_INSTANCES_NOT_HERE.' })
  @Get(':code/instances/:instanceId/progress')
  instanceProgress(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(processInstanceParamsSchema)) params: ProcessInstanceParamsDto,
  ) {
    return this.processes.instanceProgress(params.code, tenantId, params.instanceId);
  }
}
