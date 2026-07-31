/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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

  @ApiOperation({ summary: 'Vista paginada de clientes con proyección de campos' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @Get('customers')
  listCustomers(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(customerViewQuerySchema)) query: CustomerViewQueryDto) {
    return this.service.listCustomers(tenantId, query);
  }

  @ApiOperation({ summary: 'Vista paginada de decisiones de riesgo' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @Get('risk-assessments')
  listRiskAssessments(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(riskViewQuerySchema)) query: RiskViewQueryDto) {
    return this.service.listRiskAssessments(tenantId, query);
  }

  @ApiOperation({ summary: 'Cola operativa unificada y paginada' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @Get('work-queue')
  listWorkQueue(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(workQueueViewQuerySchema)) query: WorkQueueViewQueryDto) {
    return this.service.listWorkQueue(tenantId, query);
  }

  @ApiOperation({ summary: 'Último estado de salud por proveedor' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @Get('provider-health')
  listProviderHealth(@Query(new ZodValidationPipe(providerHealthViewQuerySchema)) query: ProviderHealthViewQueryDto) {
    return this.service.listProviderHealth(query);
  }

  @ApiOperation({ summary: 'Resumen paginado de entrega de notificaciones' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @Get('notification-deliveries')
  listNotificationDeliveries(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(notificationViewQuerySchema)) query: NotificationViewQueryDto,
  ) {
    return this.service.listNotificationDeliveries(tenantId, query);
  }

  @ApiOperation({ summary: 'Cobertura y release readiness por endpoint' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @Get('endpoint-coverage')
  listEndpointCoverage(@Query(new ZodValidationPipe(endpointCoverageViewQuerySchema)) query: EndpointCoverageViewQueryDto) {
    return this.service.listEndpointCoverage(query);
  }

  @ApiOperation({ summary: 'Feed de auditoría curado y paginado' })
  @ApiQuery({ name: 'fields', required: false, description: 'Campos camelCase separados por coma.' })
  @Get('audit-events')
  listAuditEvents(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(auditEventViewQuerySchema)) query: AuditEventViewQueryDto,
  ) {
    return this.service.listAuditEvents(tenantId, query);
  }
}
