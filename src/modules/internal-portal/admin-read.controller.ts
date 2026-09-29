/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  AuditEventViewQueryDto,
  CustomerViewQueryDto,
  EndpointCoverageViewQueryDto,
  NotificationViewQueryDto,
  ProviderHealthViewQueryDto,
  RiskViewQueryDto,
  WorkQueueViewQueryDto,
  GovernedViewParamDto,
  governedViewParamSchema,
  auditEventViewQuerySchema,
  customerViewQuerySchema,
  endpointCoverageViewQuerySchema,
  notificationViewQuerySchema,
  providerHealthViewQuerySchema,
  riskViewQuerySchema,
  workQueueViewQuerySchema,
} from './admin-read.schemas.js';
import { AdminReadService } from './application/admin-read.service.js';

const ADMIN_READ_ROLES = [
  'internal_operator',
  'risk_analyst',
  'fraud_analyst',
  'compliance_analyst',
  'admin',
  'platform_admin',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
] as const;

@ApiTags('internal-admin-views')
@ApiBearerAuth('access-token')
@Controller('internal/views')
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
@Roles(...ADMIN_READ_ROLES)
export class AdminReadController {
  constructor(private readonly service: AdminReadService) {}

  /*
   * Va ANTES de las rutas de cada vista sólo por legibilidad: tiene dos segmentos (`:view/facets`)
   * y no puede confundirse con ninguna de ellas.
   */
  @ApiOperation({
    summary: 'Valores de los filtros de una vista gobernada',
    description: 'Valores distintos de cada filtro sobre la vista entera (acotada al tenant si la vista lo es), hasta 200 por filtro.',
  })
  @ApiParam({ name: 'view', description: 'Clave de la vista (customers, risk-assessments, work-queue…).' })
  @Get(':view/facets')
  listFacets(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(governedViewParamSchema)) params: GovernedViewParamDto) {
    return this.service.listFacets(params.view, tenantId);
  }

  @ApiOperation({ summary: 'Vista paginada de clientes con proyección de campos' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @ApiQuery({ name: 'q', required: false, description: 'Busca (ILIKE) en código o nombre del cliente.' })
  @Get('customers')
  listCustomers(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(customerViewQuerySchema)) query: CustomerViewQueryDto) {
    return this.service.listCustomers(tenantId, query);
  }

  @ApiOperation({ summary: 'Vista paginada de decisiones de riesgo' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @ApiQuery({ name: 'q', required: false, description: 'Busca (ILIKE) en tipo de evaluación, versión de modelo o de reglas.' })
  @Get('risk-assessments')
  listRiskAssessments(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(riskViewQuerySchema)) query: RiskViewQueryDto) {
    return this.service.listRiskAssessments(tenantId, query);
  }

  @ApiOperation({ summary: 'Cola operativa unificada y paginada' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @ApiQuery({ name: 'q', required: false, description: 'Busca (ILIKE) en motivo o id del elemento.' })
  @Get('work-queue')
  listWorkQueue(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(workQueueViewQuerySchema)) query: WorkQueueViewQueryDto) {
    return this.service.listWorkQueue(tenantId, query);
  }

  @ApiOperation({ summary: 'Último estado de salud por proveedor' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @ApiQuery({ name: 'q', required: false, description: 'Busca (ILIKE) en código, nombre o error del proveedor.' })
  @Get('provider-health')
  listProviderHealth(@Query(new ZodValidationPipe(providerHealthViewQuerySchema)) query: ProviderHealthViewQueryDto) {
    return this.service.listProviderHealth(query);
  }

  @ApiOperation({ summary: 'Resumen paginado de entrega de notificaciones' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @ApiQuery({ name: 'q', required: false, description: 'Busca (ILIKE) en plantilla o último error.' })
  @Get('notification-deliveries')
  listNotificationDeliveries(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(notificationViewQuerySchema)) query: NotificationViewQueryDto,
  ) {
    return this.service.listNotificationDeliveries(tenantId, query);
  }

  @ApiOperation({ summary: 'Cobertura y release readiness por endpoint' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @ApiQuery({ name: 'q', required: false, description: 'Busca (ILIKE) en ruta o método.' })
  @Get('endpoint-coverage')
  listEndpointCoverage(@Query(new ZodValidationPipe(endpointCoverageViewQuerySchema)) query: EndpointCoverageViewQueryDto) {
    return this.service.listEndpointCoverage(query);
  }

  @ApiOperation({ summary: 'Feed de auditoría curado y paginado' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @ApiQuery({ name: 'q', required: false, description: 'Busca (ILIKE) en tipo de evento, tipo o id de destino, tabla de origen.' })
  @Get('audit-events')
  listAuditEvents(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(auditEventViewQuerySchema)) query: AuditEventViewQueryDto,
  ) {
    return this.service.listAuditEvents(tenantId, query);
  }
}
