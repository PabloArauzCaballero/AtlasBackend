/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas } from '../../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { ExternalProviderDashboardService } from '../application/external-provider-dashboard.service.js';
import {
  dashboardQuerySchema,
  DashboardQueryDto,
  providerRequestsQuerySchema,
  ProviderRequestsQueryDto,
} from '../external-providers-dashboard.schemas.js';

/**
 * Lectura de la actividad de los proveedores externos: el tablero de la pantalla y el listado de
 * solicitudes.
 *
 * Controller propio, y no dentro de `AdminExternalProvidersController`, por el trinquete
 * `check:file-size` (aquel archivo ya fue troceado una vez por tamaño y está en el baseline) y
 * porque estos dos endpoints son de SOLO LECTURA: no reconfiguran nada, así que los ven también
 * los roles de investigación.
 */
@ApiTags('external-data-admin')
@ApiBearerAuth('access-token')
@Controller('admin/external-providers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')
export class ExternalProvidersDashboardController {
  constructor(private readonly dashboardService: ExternalProviderDashboardService) {}

  @ApiOperation({
    summary: 'Tablero de actividad de proveedores externos',
    description:
      'Por proveedor: modo efectivo, última salud medida, serie de los últimos chequeos, llamadas del período con éxito/fallo/bloqueo, latencia p95 y costo. Todo sale de data_provider_requests y provider_health_logs.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'days', required: false, schema: zodObjectPropertySchemas(dashboardQuerySchema).days })
  @ApiQuery({ name: 'healthPoints', required: false, schema: zodObjectPropertySchemas(dashboardQuerySchema).healthPoints })
  @ApiResponse({ status: 200, description: 'Tablero de actividad.' })
  @Get('dashboard')
  dashboard(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQueryDto) {
    return this.dashboardService.getDashboard({
      tenantId: tenantId,
      days: query.days,
      healthPoints: query.healthPoints,
    });
  }

  @ApiOperation({
    summary: 'Listado de solicitudes a proveedores externos',
    description:
      'Solicitudes del período con filtros por proveedor, cliente, estado de respuesta y estado de aprobación. Es lo que faltaba para que la pantalla de solicitudes deje de pedir identificadores a ciegas.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'days', required: false, schema: zodObjectPropertySchemas(providerRequestsQuerySchema).days })
  @ApiQuery({ name: 'providerCode', required: false, schema: zodObjectPropertySchemas(providerRequestsQuerySchema).providerCode })
  @ApiQuery({ name: 'customerId', required: false, schema: zodObjectPropertySchemas(providerRequestsQuerySchema).customerId })
  @ApiQuery({ name: 'responseStatus', required: false, description: 'Lista separada por comas (FAILED,RATE_LIMITED).' })
  @ApiQuery({ name: 'approvalStatus', required: false, schema: zodObjectPropertySchemas(providerRequestsQuerySchema).approvalStatus })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(providerRequestsQuerySchema).limit })
  @ApiQuery({ name: 'offset', required: false, schema: zodObjectPropertySchemas(providerRequestsQuerySchema).offset })
  @ApiResponse({ status: 200, description: 'Página de solicitudes.' })
  @Get('requests')
  requests(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(providerRequestsQuerySchema)) query: ProviderRequestsQueryDto) {
    return this.dashboardService.listRequests({
      // Acotado al inquilino de la cabecera, como el resto de reportes de esta pantalla: es una
      // lista de consultas hechas SOBRE CLIENTES, no un agregado anónimo.
      tenantId: tenantId,
      days: query.days,
      providerCode: query.providerCode,
      customerId: query.customerId,
      responseStatuses: query.responseStatus,
      approvalStatus: query.approvalStatus,
      limit: query.limit,
      offset: query.offset,
    });
  }
}
